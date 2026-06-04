import { ipcMain, IpcMainInvokeEvent } from "electron";
import fs from "fs-extra";
import JSZip from "jszip";
import path from "path";
import unzipper from "unzipper";

const textDecoder = new TextDecoder("utf-8");
const REVIEW_INTERVAL_DAYS = [0, 1, 2, 4, 7, 15, 30];
const DEFAULT_SYNC_LIMIT = 10;
const MAX_SYNC_LIMIT = 100;

type VocabularySyncMode = "due_first" | "new" | "review" | "all";
type VocabularySyncOptions = {
  limit?: number;
  mode?: VocabularySyncMode;
  now?: string;
  reviews?: VocabularyWorkbookReviewType[];
};

type WorkbookMeaning = MeaningType & {
  workbook: NonNullable<MeaningType["workbook"]> & {
    rowIndex: number;
    rowNumber: number;
  };
};

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

const setAttr = (attrs: string, name: string, value: string) => {
  const encodedValue = value.replace(/"/g, "&quot;");
  const attrRegex = new RegExp(`\\s${name}="[^"]*"`, "i");
  if (attrRegex.test(attrs)) {
    return attrs.replace(attrRegex, ` ${name}="${encodedValue}"`);
  }

  return `${attrs} ${name}="${encodedValue}"`;
};

const removeAttr = (attrs: string, name: string) => {
  return attrs.replace(new RegExp(`\\s${name}="[^"]*"`, "gi"), "");
};

const columnIndex = (cellRef: string) => {
  const letters = cellRef.match(/[A-Z]+/)?.[0] || "";
  return letters.split("").reduce((sum, letter) => {
    return sum * 26 + letter.charCodeAt(0) - 64;
  }, 0);
};

const columnName = (index: number) => {
  let current = index;
  let name = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }

  return name;
};

const escapeXml = (value = "") => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
  const rowsByNumber = new Map<number, Record<string, string | number | null>>();
  const cellRegex =
    /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let cellMatch: RegExpExecArray | null;

  while ((cellMatch = cellRegex.exec(sheetXml))) {
    const attrs = cellMatch[1];
    const body = cellMatch[2] || "";
    const ref = attr(attrs, "r");
    if (!ref) continue;

    const rowNumber = numberValue(ref.match(/\d+/)?.[0]);
    if (!rowNumber) continue;

    const row = rowsByNumber.get(rowNumber) || {};
    row.__rowNumber = rowNumber;

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
    rowsByNumber.set(rowNumber, row);
  }

  const rows = [...rowsByNumber.values()].sort((a, b) => {
    return numberValue(a.__rowNumber) - numberValue(b.__rowNumber);
  });

  const headerRow = rows.shift() || {};
  const headers = Object.entries(headerRow).reduce<Record<string, string>>(
    (acc, [index, value]) => {
      if (value) acc[index] = String(value);
      return acc;
    },
    {}
  );

  let lastWordId = "";
  let lastWord = "";

  return rows.map((row) => {
    const mapped = Object.entries(row).reduce<Record<string, string | number | null>>(
      (acc, [index, value]) => {
        const header = headers[index];
        if (header) acc[header] = value;
        return acc;
      },
      {}
    );

    mapped.__rowNumber = row.__rowNumber;

    if (
      !mapped["Word ID"] &&
      numberValue(mapped["Sense #"]) > 1 &&
      mapped["Word"] &&
      mapped["Word"] === lastWord
    ) {
      mapped["Word ID"] = lastWordId;
    }
    if (mapped["Word ID"]) lastWordId = stringValue(mapped["Word ID"]);
    if (mapped["Word"]) lastWord = stringValue(mapped["Word"]);

    return mapped;
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

const parseTime = (value?: string) => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
};

const nowIso = () => new Date().toISOString();

const displayTimestamp = (iso: string) => {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
};

const addDaysIso = (iso: string, days: number) => {
  const time = parseTime(iso);
  if (time === null) return iso;

  return new Date(time + days * 24 * 60 * 60 * 1000).toISOString();
};

const clampReviewStage = (value?: number) => {
  const stage = Number(value);
  if (!Number.isFinite(stage)) return 0;

  return Math.min(
    Math.max(Math.trunc(stage), 0),
    REVIEW_INTERVAL_DAYS.length - 1
  );
};

const clampSyncLimit = (value?: number) => {
  const limit = Number(value || DEFAULT_SYNC_LIMIT);
  if (!Number.isFinite(limit)) return DEFAULT_SYNC_LIMIT;

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SYNC_LIMIT);
};

const syncMode = (mode?: string): VocabularySyncMode => {
  if (mode === "new" || mode === "review" || mode === "all") return mode;
  return "due_first";
};

const buildMeanings = (rows: Record<string, string | number | null>[]) => {
  return rows
    .filter((row) => stringValue(row["Word ID"]) && stringValue(row["Word"]))
    .map((row, index) => {
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
          rowIndex: index,
          rowNumber: numberValue(row.__rowNumber) || index + 2,
        },
      } satisfies WorkbookMeaning;
    }) as WorkbookMeaning[];
};

const reviewKey = (review: Pick<VocabularyWorkbookReviewType, "wordId" | "senseNumber">) => {
  return `${review.wordId}#${review.senseNumber}`;
};

const dedupeReviews = (reviews: VocabularyWorkbookReviewType[] = []) => {
  const byKey = new Map<string, VocabularyWorkbookReviewType>();

  for (const review of reviews) {
    if (!review.wordId || !review.senseNumber) continue;
    byKey.set(reviewKey(review), review);
  }

  return [...byKey.values()];
};

const headerColumns = (sheetXml: string, sharedStrings: string[]) => {
  const rowMatch = sheetXml.match(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/);
  const columns = new Map<string, string>();
  if (!rowMatch) return columns;

  const cellRegex =
    /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
    const attrs = cellMatch[1];
    const ref = attr(attrs, "r");
    if (!ref) continue;

    const valueMatch = (cellMatch[2] || "").match(
      /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/
    );
    if (!valueMatch) continue;

    const type = attr(attrs, "t");
    const rawValue = decodeXml(valueMatch[1]);
    const value = type === "s" ? sharedStrings[Number(rawValue)] : rawValue;
    columns.set(value, ref.match(/[A-Z]+/)?.[0] || "");
  }

  return columns;
};

const cellXml = (ref: string, value: string | number, type: "n" | "str") => {
  if (type === "n") {
    return `<x:c r="${ref}" t="n"><x:v>${value}</x:v></x:c>`;
  }

  return `<x:c r="${ref}" t="str"><x:v>${escapeXml(String(value))}</x:v></x:c>`;
};

const cleanCellAttrs = (attrs: string) => {
  return attrs.replace(/\s*\/\s*$/, "");
};

const updateCell = (
  sheetXml: string,
  ref: string,
  value: string | number,
  type: "n" | "str"
) => {
  const cellRegex = new RegExp(
    `<((?:\\w+:)?c)\\b([^>]*\\br="${ref}"[^>]*)(?:\\/>|>([\\s\\S]*?)<\\/\\1>)`
  );
  const nextValue =
    type === "n"
      ? `<x:v>${value}</x:v>`
      : `<x:v>${escapeXml(String(value))}</x:v>`;

  if (cellRegex.test(sheetXml)) {
    return sheetXml.replace(cellRegex, (_match, tag, attrs) => {
      const nextAttrs = setAttr(removeAttr(cleanCellAttrs(attrs), "t"), "t", type);
      return `<${tag}${nextAttrs}>${nextValue}</${tag}>`;
    });
  }

  const rowNumber = Number(ref.match(/\d+/)?.[0] || 0);
  const col = ref.match(/[A-Z]+/)?.[0] || "";
  const rowRegex = new RegExp(
    `(<((?:\\w+:)?row)\\b[^>]*\\br="${rowNumber}"[^>]*>)([\\s\\S]*?)(<\\/\\2>)`
  );

  return sheetXml.replace(rowRegex, (match, open, _rowTag, body, close) => {
    const newCell = cellXml(ref, value, type);
    const targetIndex = columnIndex(col);
    const existingCellRegex =
      /<((?:\w+:)?c)\b([^>]*\br="[A-Z]+\d+"[^>]*)(?:\/>|>[\s\S]*?<\/\1>)/g;
    let existingMatch: RegExpExecArray | null;
    while ((existingMatch = existingCellRegex.exec(body))) {
      const existingRef = attr(existingMatch[2], "r");
      const existingIndex = columnIndex(existingRef || "");
      if (existingIndex > targetIndex) {
        const before = body.slice(0, existingMatch.index);
        const after = body.slice(existingMatch.index);
        return `${open}${before}${newCell}${after}${close}`;
      }
    }

    return `${open}${body}${newCell}${close}`;
  });
};

const normalizeCellXml = (cell: string) => {
  return cell.replace(
    /<((?:\w+:)?c)\b([^>]*?)\/>/g,
    (_match, tag, attrs) => `<${tag}${cleanCellAttrs(attrs)} />`
  ).replace(/\s\/\s+(t="[^"]*")/g, " $1");
};

const rebuildSheetData = (sheetXml: string, sharedStrings: string[]) => {
  const sheetDataMatch = sheetXml.match(
    /<((?:\w+:)?sheetData)\b[^>]*>([\s\S]*?)<\/\1>/
  );
  if (!sheetDataMatch) return sheetXml;

  const rowAttrsByNumber = new Map<number, string>();
  const rowRegex = /<((?:\w+:)?row)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetDataMatch[2]))) {
    const rowNumber = numberValue(attr(rowMatch[2], "r"));
    if (rowNumber && !rowAttrsByNumber.has(rowNumber)) {
      rowAttrsByNumber.set(rowNumber, rowMatch[2]);
    }
  }

  const cellsByRow = new Map<number, Map<string, string>>();
  const cellRegex =
    /<((?:\w+:)?c)\b([^>]*\br="[A-Z]+\d+"[^>]*)(?:\/>|>[\s\S]*?<\/\1>)/g;
  let cellMatch: RegExpExecArray | null;
  while ((cellMatch = cellRegex.exec(sheetDataMatch[2]))) {
    const ref = attr(cellMatch[2], "r");
    const rowNumber = numberValue(ref?.match(/\d+/)?.[0]);
    const col = ref?.match(/[A-Z]+/)?.[0];
    if (!rowNumber || !col || !ref) continue;

    const rowCells = cellsByRow.get(rowNumber) || new Map<string, string>();
    rowCells.set(col, normalizeCellXml(cellMatch[0]));
    cellsByRow.set(rowNumber, rowCells);
  }

  const parsedRows = parseRows(sheetXml, sharedStrings);
  for (const row of parsedRows) {
    const rowNumber = numberValue(row.__rowNumber);
    const wordId = stringValue(row["Word ID"]);
    const word = stringValue(row["Word"]);
    if (!rowNumber || !wordId || !word) continue;

    const rowCells = cellsByRow.get(rowNumber) || new Map<string, string>();
    if (!rowCells.has("A")) {
      rowCells.set("A", cellXml(`A${rowNumber}`, wordId, "str"));
      cellsByRow.set(rowNumber, rowCells);
    }
  }

  const rowXml = [...cellsByRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rowNumber, rowCells]) => {
      const attrs =
        cleanCellAttrs(rowAttrsByNumber.get(rowNumber) || ` r="${rowNumber}"`);
      const cells = [...rowCells.entries()]
        .sort(([a], [b]) => columnIndex(a) - columnIndex(b))
        .map(([, cell]) => cell)
        .join("");

      return `<x:row${attrs}>${cells}</x:row>`;
    })
    .join("");

  return sheetXml.replace(
    sheetDataMatch[0],
    `<${sheetDataMatch[1]}>${rowXml}</${sheetDataMatch[1]}>`
  );
};

const writeWorkbookReviews = async (
  filePath: string,
  reviews: VocabularyWorkbookReviewType[] = []
) => {
  const uniqueReviews = dedupeReviews(reviews);
  if (uniqueReviews.length === 0) return 0;

  const directory = await unzipper.Open.file(filePath);
  const sheetPath = await vocabularySheetPath(directory);
  const rawSheetXml = await readZipEntry(directory, sheetPath);
  const sharedStringsXml = await readZipEntry(directory, "xl/sharedStrings.xml");
  if (!rawSheetXml) {
    throw new Error(`Vocabulary sheet file not found: ${sheetPath}`);
  }

  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheetXml = rebuildSheetData(rawSheetXml, sharedStrings);
  const rows = parseRows(sheetXml, sharedStrings);
  const meanings = buildMeanings(rows);
  const meaningsByKey = new Map(
    meanings.map((meaning) => [
      reviewKey({
        wordId: meaning.workbook.wordId,
        senseNumber: meaning.workbook.senseNumber,
      }),
      meaning,
    ])
  );
  const columns = headerColumns(sheetXml, sharedStrings);
  const requiredHeaders = [
    "Review Count",
    "Mastery",
    "Last Reviewed",
    "Review Stage",
    "Next Review At",
  ];

  for (const header of requiredHeaders) {
    if (!columns.get(header)) {
      throw new Error(`Vocabulary sheet is missing required column: ${header}`);
    }
  }

  for (const review of uniqueReviews) {
    if (!meaningsByKey.has(reviewKey(review))) {
      throw new Error(
        `Vocabulary review target not found in workbook: ${review.wordId} S${review.senseNumber}`
      );
    }
  }

  let nextSheetXml = sheetXml;
  for (const review of uniqueReviews) {
    const meaning = meaningsByKey.get(reviewKey(review));
    const rowNumber = meaning.workbook.rowNumber;
    const reviewedAt = review.reviewedAt || nowIso();
    const reviewCount = Number(meaning.workbook.reviewCount || 0) + 1;
    const mastery = review.mastery === 1 ? 1 : 0;
    const reviewStage =
      mastery === 1
        ? Math.min(
            clampReviewStage(meaning.workbook.reviewStage) + 1,
            REVIEW_INTERVAL_DAYS.length - 1
          )
        : 0;
    const nextReviewAt =
      mastery === 1
        ? addDaysIso(reviewedAt, REVIEW_INTERVAL_DAYS[reviewStage])
        : reviewedAt;

    nextSheetXml = updateCell(
      nextSheetXml,
      `${columns.get("Review Count")}${rowNumber}`,
      reviewCount,
      "n"
    );
    nextSheetXml = updateCell(
      nextSheetXml,
      `${columns.get("Mastery")}${rowNumber}`,
      mastery,
      "n"
    );
    nextSheetXml = updateCell(
      nextSheetXml,
      `${columns.get("Last Reviewed")}${rowNumber}`,
      displayTimestamp(reviewedAt),
      "str"
    );
    nextSheetXml = updateCell(
      nextSheetXml,
      `${columns.get("Review Stage")}${rowNumber}`,
      reviewStage,
      "n"
    );
    nextSheetXml = updateCell(
      nextSheetXml,
      `${columns.get("Next Review At")}${rowNumber}`,
      displayTimestamp(nextReviewAt),
      "str"
    );
  }

  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  zip.file(sheetPath, nextSheetXml);

  const tempPath = `${filePath}.enjoy-sync-${Date.now()}.tmp`;
  await fs.writeFile(
    tempPath,
    await zip.generateAsync({ compression: "DEFLATE", type: "nodebuffer" })
  );
  await fs.move(tempPath, filePath, { overwrite: true });

  return uniqueReviews.length;
};

const isDueForReview = (meaning: WorkbookMeaning, nowMs: number) => {
  const dueMs = parseTime(meaning.workbook.nextReviewAt);
  return dueMs !== null && dueMs <= nowMs;
};

const compareForSelection = (
  a: WorkbookMeaning,
  b: WorkbookMeaning,
  type: "new" | "review",
  nowMs: number
) => {
  if (type === "review") {
    const masteryDiff =
      Number(a.workbook.mastery || 0) - Number(b.workbook.mastery || 0);
    if (masteryDiff !== 0) return masteryDiff;

    const aOverdue = nowMs - (parseTime(a.workbook.nextReviewAt) || 0);
    const bOverdue = nowMs - (parseTime(b.workbook.nextReviewAt) || 0);
    if (aOverdue !== bOverdue) return bOverdue - aOverdue;

    const stageDiff =
      clampReviewStage(a.workbook.reviewStage) -
      clampReviewStage(b.workbook.reviewStage);
    if (stageDiff !== 0) return stageDiff;
  } else {
    const countDiff =
      Number(a.workbook.reviewCount || 0) - Number(b.workbook.reviewCount || 0);
    if (countDiff !== 0) return countDiff;
  }

  if (a.workbook.wordId !== b.workbook.wordId) {
    return a.workbook.wordId.localeCompare(b.workbook.wordId);
  }

  if (a.workbook.senseNumber !== b.workbook.senseNumber) {
    return a.workbook.senseNumber - b.workbook.senseNumber;
  }

  return a.workbook.rowIndex - b.workbook.rowIndex;
};

const selectUniqueWords = (
  ordered: WorkbookMeaning[],
  limit: number,
  selected: WorkbookMeaning[] = []
) => {
  const seenWords = new Set(
    selected.map((meaning) => meaning.workbook.wordId || meaning.word)
  );
  const seenMeanings = new Set(selected.map((meaning) => meaning.id));

  for (const meaning of ordered) {
    if (selected.length >= limit) break;

    const wordKey = meaning.workbook.wordId || meaning.word;
    if (seenWords.has(wordKey) || seenMeanings.has(meaning.id)) continue;

    selected.push(meaning);
    seenWords.add(wordKey);
    seenMeanings.add(meaning.id);
    if (selected.length >= limit) break;
  }

  return selected;
};

const selectMeanings = (
  meanings: WorkbookMeaning[],
  options: VocabularySyncOptions = {}
) => {
  const limit = clampSyncLimit(options.limit);
  const mode = syncMode(options.mode);
  const nowMs = parseTime(options.now) || Date.now();
  const byWorkbookOrder = [...meanings].sort((a, b) => {
    if (a.workbook.wordId !== b.workbook.wordId) {
      return a.workbook.wordId.localeCompare(b.workbook.wordId);
    }

    return a.workbook.senseNumber - b.workbook.senseNumber;
  });
  const dueReviewMeanings = meanings
    .filter((meaning) => isDueForReview(meaning, nowMs))
    .sort((a, b) => compareForSelection(a, b, "review", nowMs));
  const newMeanings = meanings
    .filter((meaning) => Number(meaning.workbook.reviewCount || 0) === 0)
    .sort((a, b) => compareForSelection(a, b, "new", nowMs));

  if (mode === "review") {
    return {
      limit,
      mode,
      dueReviewCount: dueReviewMeanings.length,
      newMeaningCount: newMeanings.length,
      meanings: selectUniqueWords(dueReviewMeanings, limit),
    };
  }

  if (mode === "new") {
    return {
      limit,
      mode,
      dueReviewCount: dueReviewMeanings.length,
      newMeaningCount: newMeanings.length,
      meanings: selectUniqueWords(newMeanings, limit),
    };
  }

  if (mode === "all") {
    return {
      limit,
      mode,
      dueReviewCount: dueReviewMeanings.length,
      newMeaningCount: newMeanings.length,
      meanings: selectUniqueWords(byWorkbookOrder, limit),
    };
  }

  const selected = selectUniqueWords(dueReviewMeanings, limit);
  selectUniqueWords(newMeanings, limit, selected);

  return {
    limit,
    mode,
    dueReviewCount: dueReviewMeanings.length,
    newMeaningCount: newMeanings.length,
    meanings: selected,
  };
};

const syncWorkbook = async (
  _event: IpcMainInvokeEvent,
  filePath: string,
  options: VocabularySyncOptions = {}
) => {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Vocabulary workbook not found: ${filePath}`);
  }

  const appliedReviewCount = await writeWorkbookReviews(
    filePath,
    options.reviews || []
  );
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
  const selected = selectMeanings(meanings, options);
  const selectedWords = new Set(selected.meanings.map((meaning) => meaning.word));
  const stat = fs.statSync(filePath);

  return {
    sourcePath: filePath,
    sourceMtimeMs: stat.mtimeMs,
    syncedAt: new Date().toISOString(),
    wordCount: selectedWords.size,
    meaningCount: selected.meanings.length,
    selectedWordCount: selectedWords.size,
    selectedMeaningCount: selected.meanings.length,
    sourceWordCount: uniqueWords.size,
    sourceMeaningCount: meanings.length,
    dueReviewCount: selected.dueReviewCount,
    newMeaningCount: selected.newMeaningCount,
    appliedReviewCount,
    syncLimit: selected.limit,
    syncMode: selected.mode,
    rowCount: rows.length,
    meanings: selected.meanings,
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
