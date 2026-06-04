import { ipcMain, IpcMainInvokeEvent } from "electron";
import fs from "fs-extra";
import path from "path";
import unzipper from "unzipper";

const textDecoder = new TextDecoder("utf-8");

const decodeXml = (value = "") => {
  return value
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

const attr = (attrs: string, name: string) => {
  const match = attrs.match(new RegExp(`${name.replace(":", "\\:")}="([^"]*)"`, "i"));
  return match?.[1];
};

const columnIndex = (cellRef: string) => {
  const letters = cellRef.match(/[A-Z]+/)?.[0] || "";
  return letters.split("").reduce((sum, letter) => {
    return sum * 26 + letter.charCodeAt(0) - 64;
  }, 0);
};

const parseSharedStrings = (xml?: string) => {
  if (!xml) return [];

  const strings: string[] = [];
  const siRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let siMatch: RegExpExecArray | null;

  while ((siMatch = siRegex.exec(xml))) {
    const textParts: string[] = [];
    const tRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let tMatch: RegExpExecArray | null;

    while ((tMatch = tRegex.exec(siMatch[1]))) {
      textParts.push(decodeXml(tMatch[1]));
    }

    strings.push(textParts.join(""));
  }

  return strings;
};

const normalizeTarget = (target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("xl/")) return target;
  return path.posix.join("xl", target);
};

const readZipEntry = async (
  directory: unzipper.CentralDirectory,
  entryPath: string
) => {
  const entry = directory.files.find((file) => file.path === entryPath);
  if (!entry) return null;

  return textDecoder.decode(await entry.buffer());
};

const vocabularySheetPath = async (directory: unzipper.CentralDirectory) => {
  const workbookXml = await readZipEntry(directory, "xl/workbook.xml");
  const relsXml = await readZipEntry(directory, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) {
    throw new Error("Invalid workbook: missing workbook metadata");
  }

  const relationships = new Map<string, string>();
  const relRegex = /<(?:\w+:)?Relationship\b([^>]*)\/>/g;
  let relMatch: RegExpExecArray | null;
  while ((relMatch = relRegex.exec(relsXml))) {
    const id = attr(relMatch[1], "Id");
    const target = attr(relMatch[1], "Target");
    if (id && target) relationships.set(id, normalizeTarget(target));
  }

  const sheetRegex = /<(?:\w+:)?sheet\b([^>]*)\/>/g;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetRegex.exec(workbookXml))) {
    const name = attr(sheetMatch[1], "name");
    const relationshipId = attr(sheetMatch[1], "r:id");
    if (name === "Vocabulary" && relationshipId) {
      const sheetPath = relationships.get(relationshipId);
      if (sheetPath) return sheetPath;
    }
  }

  throw new Error('Workbook does not contain a "Vocabulary" sheet');
};

const parseRows = (sheetXml: string, sharedStrings: string[]) => {
  const rows: Record<string, string | number | null>[] = [];
  const rowRegex = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const row: Record<string, string | number | null> = {};
    const cellRegex =
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] || "";
      const ref = attr(attrs, "r");
      if (!ref) continue;

      const valueMatch = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/);
      const inlineTextMatch = body.match(
        /<(?:\w+:)?is\b[^>]*>[\s\S]*?<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>[\s\S]*?<\/(?:\w+:)?is>/
      );
      const type = attr(attrs, "t");
      const rawValue = valueMatch?.[1] ?? inlineTextMatch?.[1];
      let value: string | number | null = rawValue ? decodeXml(rawValue) : null;

      if (type === "s" && value !== null) {
        value = sharedStrings[Number(value)] ?? "";
      } else if (type === "n" && value !== null) {
        const numeric = Number(value);
        value = Number.isNaN(numeric) ? value : numeric;
      }

      row[String(columnIndex(ref))] = value;
    }

    rows.push(row);
  }

  const headerRow = rows.shift() || {};
  const headers = Object.entries(headerRow).reduce<Record<string, string>>(
    (acc, [index, value]) => {
      if (value) acc[index] = String(value);
      return acc;
    },
    {}
  );

  return rows.map((row) => {
    return Object.entries(row).reduce<Record<string, string | number | null>>(
      (acc, [index, value]) => {
        const header = headers[index];
        if (header) acc[header] = value;
        return acc;
      },
      {}
    );
  });
};

const stringValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const numberValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? 0 : numeric;
};

const buildMeanings = (rows: Record<string, string | number | null>[]) => {
  return rows
    .filter((row) => stringValue(row["Word ID"]) && stringValue(row["Word"]))
    .map((row) => {
      const wordId = stringValue(row["Word ID"]);
      const word = stringValue(row["Word"]);
      const senseNumber = numberValue(row["Sense #"]) || 1;
      const sourceSentence = stringValue(row["Source Sentence"]);
      const englishExample = stringValue(row["English Example"]);
      const notes = stringValue(row["Notes"]);
      const id = `${wordId}-S${senseNumber}`;

      return {
        id,
        word,
        pos: stringValue(row["POS"]),
        definition: stringValue(row["English Definition"]),
        translation: stringValue(row["中文意思"]),
        lookups: [
          {
            id: `${id}-lookup`,
            word,
            context: sourceSentence || englishExample,
            contextTranslation: [englishExample, notes]
              .filter(Boolean)
              .join("\n\n"),
            status: "completed",
            createdAt: stringValue(row["Study At"]) || new Date().toISOString(),
            updatedAt:
              stringValue(row["Last Reviewed"]) ||
              stringValue(row["Study At"]) ||
              new Date().toISOString(),
          },
        ],
        workbook: {
          wordId,
          senseNumber,
          sourceSentence,
          englishExample,
          etymology: stringValue(row["Etymology / Sense Development (EN)"]),
          notes,
          reviewCount: numberValue(row["Review Count"]),
          mastery: numberValue(row["Mastery"]),
          reviewStage: numberValue(row["Review Stage"]),
          lastReviewed: stringValue(row["Last Reviewed"]),
          nextReviewAt: stringValue(row["Next Review At"]),
          studySessionId: stringValue(row["Study Session ID"]),
          studyAt: stringValue(row["Study At"]),
        },
      };
    });
};

const syncWorkbook = async (_event: IpcMainInvokeEvent, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Vocabulary workbook not found: ${filePath}`);
  }

  const directory = await unzipper.Open.file(filePath);
  const sheetPath = await vocabularySheetPath(directory);
  const sheetXml = await readZipEntry(directory, sheetPath);
  const sharedStringsXml = await readZipEntry(directory, "xl/sharedStrings.xml");
  if (!sheetXml) {
    throw new Error(`Vocabulary sheet file not found: ${sheetPath}`);
  }

  const rows = parseRows(sheetXml, parseSharedStrings(sharedStringsXml));
  const meanings = buildMeanings(rows);
  const uniqueWords = new Set(meanings.map((meaning) => meaning.word));
  const stat = fs.statSync(filePath);

  return {
    sourcePath: filePath,
    sourceMtimeMs: stat.mtimeMs,
    syncedAt: new Date().toISOString(),
    wordCount: uniqueWords.size,
    meaningCount: meanings.length,
    rowCount: rows.length,
    meanings,
  };
};

class VocabularyWorkbook {
  registerIpcHandlers() {
    ipcMain.handle("vocabulary-sync-workbook", syncWorkbook);
  }

  unregisterIpcHandlers() {
    ipcMain.removeHandler("vocabulary-sync-workbook");
  }
}

export default new VocabularyWorkbook();
