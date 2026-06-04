import { t } from "i18next";
import { Button, Input, Switch, toast } from "@renderer/components/ui";
import { useContext, useEffect, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";

export const VocabularySettings = () => {
  const { EnjoyApp, vocabularyConfig, setVocabularyConfig } = useContext(
    AppSettingsProviderContext
  );
  const [workbookPath, setWorkbookPath] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    setWorkbookPath(vocabularyConfig?.workbookPath || "");
  }, [vocabularyConfig?.workbookPath]);

  const syncWorkbook = async () => {
    const path = workbookPath.trim();
    if (!path) return;

    setSyncing(true);
    try {
      const result = await EnjoyApp.vocabulary.syncWorkbook(path);
      await setVocabularyConfig({
        ...vocabularyConfig,
        lookupOnMouseOver: vocabularyConfig?.lookupOnMouseOver ?? true,
        workbookPath: path,
        syncedAt: result.syncedAt,
        syncedWorkbookMtimeMs: result.sourceMtimeMs,
        syncedWordCount: result.wordCount,
        syncedMeaningCount: result.meaningCount,
        syncedMeanings: result.meanings,
      });
      toast.success(
        `Synced ${result.wordCount} words / ${result.meaningCount} meanings`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  };

  const chooseWorkbook = async () => {
    const paths = await EnjoyApp.dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Excel workbooks", extensions: ["xlsx"] }],
    });

    if (paths?.[0]) setWorkbookPath(paths[0]);
  };

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-start justify-between">
        <div className="">
          <div className="mb-2">{t("lookupOnMouseOver")}</div>
        </div>

        <div className="">
          <Switch
            checked={vocabularyConfig?.lookupOnMouseOver ?? true}
            onCheckedChange={() => {
              setVocabularyConfig({
                ...vocabularyConfig,
                lookupOnMouseOver: !(
                  vocabularyConfig?.lookupOnMouseOver ?? true
                ),
              });
            }}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-2">Vocabulary workbook</div>
          <div className="text-sm text-muted-foreground">
            Read-only source. Sync copies words into Enjoy local settings
            without changing the workbook.
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={workbookPath}
            onChange={(event) => setWorkbookPath(event.target.value)}
            placeholder="/path/to/vocab.xlsx"
          />
          <Button variant="secondary" onClick={chooseWorkbook}>
            Choose
          </Button>
          <Button onClick={syncWorkbook} disabled={syncing || !workbookPath}>
            {syncing ? "Syncing..." : "Sync"}
          </Button>
        </div>

        {vocabularyConfig?.syncedAt && (
          <div className="text-sm text-muted-foreground">
            Last synced {new Date(vocabularyConfig.syncedAt).toLocaleString()}:
            {" "}
            {vocabularyConfig.syncedWordCount || 0} words /{" "}
            {vocabularyConfig.syncedMeaningCount || 0} meanings
          </div>
        )}
      </div>
    </div>
  );
};
