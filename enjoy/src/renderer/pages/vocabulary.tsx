import { Button } from "@renderer/components/ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState, useContext, useEffect } from "react";
import {
  AppSettingsProviderContext,
  HotKeysSettingsProviderContext,
} from "@renderer/context";
import {
  LoaderSpin,
  MeaningMemorizingCard,
  NoRecordsFound,
} from "@renderer/components";
import { useHotkeys } from "react-hotkeys-hook";

export default () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [meanings, setMeanings] = useState<MeaningType[]>([]);
  const [error, setError] = useState<string>("");
  const { EnjoyApp, webApi, vocabularyConfig, setVocabularyConfig } =
    useContext(AppSettingsProviderContext);
  const { currentHotkeys, enabled } = useContext(
    HotKeysSettingsProviderContext
  );
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [nextPage, setNextPage] = useState<number | null>(1);

  const applyLocalMeanings = (items: MeaningType[]) => {
    setMeanings(items);
    setCurrentIndex(0);
    setNextPage(null);
  };

  const syncLocalWorkbook = async () => {
    const workbookPath = vocabularyConfig?.workbookPath?.trim();
    if (!workbookPath) {
      applyLocalMeanings(vocabularyConfig?.syncedMeanings || []);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await EnjoyApp.vocabulary.syncWorkbook(workbookPath);
      await setVocabularyConfig({
        ...vocabularyConfig,
        lookupOnMouseOver: vocabularyConfig?.lookupOnMouseOver ?? true,
        workbookPath,
        syncedAt: result.syncedAt,
        syncedWorkbookMtimeMs: result.sourceMtimeMs,
        syncedWordCount: result.wordCount,
        syncedMeaningCount: result.meaningCount,
        syncedMeanings: result.meanings,
      });
      applyLocalMeanings(result.meanings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      applyLocalMeanings(vocabularyConfig?.syncedMeanings || []);
    } finally {
      setLoading(false);
    }
  };

  const fetchMeanings = async (page: number | null = nextPage) => {
    if (!page) return;
    if (loading) return;

    if (!webApi) {
      const localMeanings = vocabularyConfig?.syncedMeanings || [];
      if (localMeanings.length > 0) {
        applyLocalMeanings(localMeanings);
      } else {
        await syncLocalWorkbook();
      }
      return;
    }

    setLoading(true);
    webApi
      .mineMeanings({ page, items: 10 })
      .then((response) => {
        setMeanings((previous) =>
          page === 1 ? response.meanings : [...previous, ...response.meanings]
        );
        if (page === 1) setCurrentIndex(0);
        setNextPage(response.next);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!vocabularyConfig) return;
    fetchMeanings(1);
  }, [vocabularyConfig?.workbookPath]);

  useHotkeys(
    [currentHotkeys.PlayPreviousSegment, currentHotkeys.PlayNextSegment],
    (keyboardEvent, hotkeyEvent) => {
      keyboardEvent.preventDefault();

      switch (hotkeyEvent.keys.join("")) {
        case currentHotkeys.PlayPreviousSegment.toLowerCase():
          document.getElementById("vocabulary-previous-button").click();
          break;
        case currentHotkeys.PlayNextSegment.toLowerCase():
          document.getElementById("vocabulary-next-button").click();
          break;
      }
    },
    {
      enabled,
    },
    []
  );

  if (loading && meanings.length === 0) {
    return <LoaderSpin />;
  }

  return (
    <div className="h-[100vh]">
      <div className="max-w-screen-md mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="font-bold text-2xl">Vocabulary</h1>
            <div className="text-sm text-muted-foreground">
              {vocabularyConfig?.syncedAt
                ? `${vocabularyConfig.syncedWordCount || 0} words / ${
                    vocabularyConfig.syncedMeaningCount || 0
                  } meanings synced`
                : "Sync your local workbook to study vocabulary here"}
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={syncLocalWorkbook}
            disabled={loading || !vocabularyConfig?.workbookPath}
          >
            <RefreshCwIcon
              className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            Sync
          </Button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {meanings.length === 0 ? (
          <div className="h-[calc(100vh-9rem)]">
            <NoRecordsFound text="No synced vocabulary yet" />
          </div>
        ) : (
          <div className="h-[calc(100vh-8rem)] flex items-center justify-between space-x-6">
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full"
              id="vocabulary-previous-button"
              disabled={currentIndex <= 0}
              onClick={() => {
                if (currentIndex > 0) {
                  setCurrentIndex(currentIndex - 1);
                }
              }}
            >
              <ChevronLeftIcon className="size-5" />
            </Button>
            <div className="bg-background flex-1 h-5/6 border p-6 rounded-xl shadow-xl">
              <MeaningMemorizingCard meaning={meanings[currentIndex]} />
            </div>
            <Button
              variant="secondary"
              size="icon"
              className="rounded-full"
              id="vocabulary-next-button"
              disabled={currentIndex >= meanings.length - 1 && !nextPage}
              onClick={() => {
                if (currentIndex < meanings.length - 1) {
                  setCurrentIndex(currentIndex + 1);
                }
                if (currentIndex === meanings.length - 2 && nextPage) {
                  fetchMeanings(nextPage);
                }
              }}
            >
              <ChevronRightIcon className="size-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
