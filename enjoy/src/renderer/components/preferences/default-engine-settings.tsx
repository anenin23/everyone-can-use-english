import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
  toast,
  Form,
  Button,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@renderer/components/ui";
import {
  AISettingsProviderContext,
  AppSettingsProviderContext,
} from "@renderer/context";
import { useContext, useEffect, useState } from "react";
import { GPT_PROVIDERS } from "@renderer/components";
import { LOCAL_APP_MODE } from "@/constants";
import {
  fetchOpenAiModelIds,
  parseModelList,
  serializeModelList,
} from "@renderer/lib/openai-models";

const LOCAL_GPT_PROVIDERS = {
  openai: GPT_PROVIDERS.openai,
  ollama: GPT_PROVIDERS.ollama,
};

const DEFAULT_LOCAL_ENGINE: GptEngineSettingType = {
  name: "ollama",
  models: {
    default: "llama3.2",
  },
};

export const DefaultEngineSettings = () => {
  const { currentGptEngine, setGptEngine, openai, setOpenai } = useContext(
    AISettingsProviderContext
  );
  const { webApi } = useContext(AppSettingsProviderContext);
  const [providers, setProviders] = useState<any>(
    LOCAL_APP_MODE ? LOCAL_GPT_PROVIDERS : GPT_PROVIDERS
  );
  const [editing, setEditing] = useState(false);
  const [fetchingOpenAiModels, setFetchingOpenAiModels] = useState(false);
  const safeGptEngine =
    currentGptEngine?.name && providers[currentGptEngine.name]
      ? currentGptEngine
      : LOCAL_APP_MODE
      ? DEFAULT_LOCAL_ENGINE
      : ({
          name: "enjoyai",
          models: {
            default: "gpt-4o",
          },
        } as GptEngineSettingType);

  const gptEngineSchema = z
    .object({
      name: z.enum(["enjoyai", "openai", "ollama"]),
      models: z.object({
        default: z.string(),
        lookup: z.string().optional(),
        translate: z.string().optional(),
        analyze: z.string().optional(),
        extractStory: z.string().optional(),
      }),
    })
    .required();

  const form = useForm<z.infer<typeof gptEngineSchema>>({
    resolver: zodResolver(gptEngineSchema),
    values: {
      name: safeGptEngine.name as "enjoyai" | "openai" | "ollama",
      models: safeGptEngine.models || {},
    },
  });

  const modelOptions = () => {
    if (form.watch("name") === "openai") {
      const customModels = parseModelList(openai?.models);

      return customModels?.length ? customModels : providers.openai?.models || [];
    } else if (form.watch("name") === "ollama") {
      return providers.ollama?.models?.length
        ? providers.ollama.models
        : [safeGptEngine.models?.default || "llama3.2"];
    } else {
      return providers.enjoyai?.models || [];
    }
  };

  const onSubmit = async (data: z.infer<typeof gptEngineSchema>) => {
    const { name, models } = data;

    let options = [...(providers[name]?.models || [])];
    if (name === "openai" && openai?.models) {
      options = parseModelList(openai.models);
    }
    if (!options.length) {
      options = [models.default || "llama3.2"];
    }

    models.default ||= options[0];
    Object.keys(models).forEach((key: keyof typeof models) => {
      if (!options.includes(models[key])) {
        if (key === "default") {
          models[key] = options[0];
        } else {
          delete models[key];
        }
      }
    });

    setGptEngine(data as GptEngineSettingType);
    setEditing(false);
  };

  useEffect(() => {
    if (LOCAL_APP_MODE || !webApi) return;

    webApi
      .config("gpt_providers")
      .then((data) => {
        setProviders(data);
      })
      .catch((error) => {
        console.error(error);
      });
  }, []);

  useEffect(() => {
    if (!openai?.key || parseModelList(openai.models).length) return;

    setFetchingOpenAiModels(true);
    fetchOpenAiModelIds(openai)
      .then((models) => {
        const serializedModels = serializeModelList(models);
        setProviders((currentProviders: any) => ({
          ...currentProviders,
          openai: {
            ...currentProviders.openai,
            models,
          },
        }));
        return setOpenai?.({
          ...openai,
          models: serializedModels,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to fetch OpenAI models: ${message}`);
      })
      .finally(() => {
        setFetchingOpenAiModels(false);
      });
  }, [openai?.key, openai?.baseUrl]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="">
            <div className="flex items-center mb-2">
              <span>{t("defaultAiEngine")}</span>
            </div>
            <div className="text-sm text-muted-foreground space-y-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("aiEngine")}:
                      </FormLabel>
                      <Select
                        value={field.value}
                        disabled={!editing}
                        onValueChange={(value) => {
                          if (value === "openai" && !openai?.key) {
                            toast.warning(t("openaiKeyRequired"));
                          } else {
                            field.onChange(value);
                          }
                        }}
                      >
                        <SelectTrigger className="min-w-fit">
                          <SelectValue
                            placeholder={t("defaultAiEngine")}
                          ></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {!LOCAL_APP_MODE && (
                            <SelectItem value="enjoyai">EnjoyAI</SelectItem>
                          )}
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="ollama">Ollama</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <FormMessage />
                    <div className="text-xs text-muted-foreground">
                      {form.watch("name") === "openai" && t("openAiEngineTips")}
                      {form.watch("name") === "openai" &&
                        fetchingOpenAiModels &&
                        ` ${t("loading")}`}
                      {form.watch("name") === "enjoyai" &&
                        t("enjoyAiEngineTips")}
                      {form.watch("name") === "ollama" &&
                        t("ensureYouHaveOllamaRunningLocallyAndHasAtLeastOneModel")}
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="models.default"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("defaultAiModel")}:
                      </FormLabel>
                      <Select
                        value={field.value}
                        disabled={!editing}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger className="min-w-fit">
                          <SelectValue
                            placeholder={t("defaultAiModel")}
                          ></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions().map((model: string) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </FormItem>
                )}
              />
              {editing && (
                <>
                  <FormField
                    control={form.control}
                    name="models.lookup"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("lookupAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.translate"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("translateAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.analyze"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("analyzeAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="models.extractStory"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center space-x-2">
                          <FormLabel className="min-w-max">
                            {t("extractStoryAiModel")}:
                          </FormLabel>
                          <Select
                            value={field.value}
                            disabled={!editing}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger className="min-w-fit">
                              <SelectValue
                                placeholder={t("leaveEmptyToUseDefault")}
                              ></SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {modelOptions().map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </FormItem>
                    )}
                  />
                </>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant={editing ? "outline" : "secondary"}
              size="sm"
              type="reset"
              onClick={(event) => {
                event.preventDefault();
                form.reset();
                setEditing(!editing);
              }}
            >
              {editing ? t("cancel") : t("edit")}
            </Button>
            <Button className={editing ? "" : "hidden"} size="sm" type="submit">
              {t("save")}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
