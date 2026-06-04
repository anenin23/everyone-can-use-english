import { t } from "i18next";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  toast,
} from "@renderer/components/ui";
import { useContext, useEffect, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";

const clampSyncLimit = (value: string | number | undefined) => {
  const limit = Number(value || 10);
  if (!Number.isFinite(limit)) return 10;

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
};

export const VocabularySettings = () => {
  const { EnjoyApp, vocabularyConfig, setVocabularyConfig } = useContext(
    AppSettingsProviderContext
  );
  const [workbookPath, setWorkbookPath] = useState("");
  const [syncing, setSyncing] = useState(false);
  const syncLimit = vocabularyConfig?.syncLimit || 10;
  const syncMode = vocabularyConfig?.syncMode || "due_first";

  useEffect(() => {
    setWorkbookPath(vocabularyConfig?.workbookPath || "");
  }, [vocabularyConfig?.workbookPath]);

  const syncWorkbook = async () => {
    const path = workbookPath.trim();
    if (!path) return;

    setSyncing(true);
    try {
      const result = await EnjoyApp.vocabulary.syncWorkbook(path, {
        limit: syncLimit,
        mode: syncMode,
        reviews: vocabularyConfig?.pendingReviews || [],
      });
      await setVocabularyConfig({
        ...vocabularyConfig,
        lookupOnMouseOver: vocabularyConfig?.lookupOnMouseOver ?? true,
        workbookPath: path,
        syncLimit: result.syncLimit,
        syncMode: result.syncMode,
        syncedAt: result.syncedAt,
        syncedWorkbookMtimeMs: result.sourceMtimeMs,
        syncedWordCount: result.selectedWordCount,
        syncedMeaningCount: result.selectedMeaningCount,
        sourceWordCount: result.sourceWordCount,
        sourceMeaningCount: result.sourceMeaningCount,
        dueReviewCount: result.dueReviewCount,
        newMeaningCount: result.newMeaningCount,
        syncedMeanings: result.meanings,
        pendingReviews: [],
      });
      toast.success(
        `Synced ${result.selectedWordCount} selected words / ${result.selectedMeaningCount} meanings`
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-2 text-sm font-medium">Batch size</div>
            <Input
              type="number"
              min={1}
              max={100}
              step={1}
              value={syncLimit}
              onChange={(event) => {
                setVocabularyConfig({
                  ...vocabularyConfig,
                  lookupOnMouseOver: vocabularyConfig?.lookupOnMouseOver ?? true,
                  syncLimit: clampSyncLimit(event.target.value),
                  syncMode,
                });
              }}
            />
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Sync mode</div>
            <Select
              value={syncMode}
              onValueChange={(value) => {
                setVocabularyConfig({
                  ...vocabularyConfig,
                  lookupOnMouseOver: vocabularyConfig?.lookupOnMouseOver ?? true,
                  syncLimit,
                  syncMode: value as VocabularySyncModeType,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="due_first">Due first</SelectItem>
                <SelectItem value="review">Review only</SelectItem>
                <SelectItem value="new">New only</SelectItem>
                <SelectItem value="all">Workbook order</SelectItem>
              </SelectContent>
            </Select>
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
            {vocabularyConfig.syncedMeaningCount || 0} meanings selected from{" "}
            {vocabularyConfig.sourceWordCount ||
              vocabularyConfig.syncedWordCount ||
              0}{" "}
            workbook words
          </div>
        )}

        {(vocabularyConfig?.pendingReviews || []).length > 0 && (
          <div className="text-sm text-muted-foreground">
            {(vocabularyConfig?.pendingReviews || []).length} review updates
            will be written back on the next sync.
          </div>
        )}
      </div>
    </div>
  );
};
