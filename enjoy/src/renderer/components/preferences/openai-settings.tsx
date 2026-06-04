import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { t } from "i18next";
import {
  Button,
  FormField,
  Form,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  toast,
  FormDescription,
} from "@renderer/components/ui";
import { AISettingsProviderContext } from "@renderer/context";
import { useContext, useState } from "react";
import {
  fetchOpenAiModelIds,
  parseModelList,
  serializeModelList,
} from "@renderer/lib/openai-models";

export const OpenaiSettings = () => {
  const { openai, setOpenai } = useContext(AISettingsProviderContext);
  const [editing, setEditing] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);

  const openAiConfigSchema = z.object({
    key: z.string().optional(),
    baseUrl: z.string().optional(),
    models: z.string().optional(),
  });

  const form = useForm<z.infer<typeof openAiConfigSchema>>({
    resolver: zodResolver(openAiConfigSchema),
    values: {
      key: openai?.key,
      baseUrl: openai?.baseUrl,
      models: openai?.models,
    },
  });

  const refreshModels = async (config: z.infer<typeof openAiConfigSchema>) => {
    if (!config.key) {
      toast.warning(t("openaiKeyRequired"));
      return config.models || "";
    }

    setRefreshingModels(true);
    try {
      const models = await fetchOpenAiModelIds(config);
      const serializedModels = serializeModelList(models);
      form.setValue("models", serializedModels);
      toast.success(t("openaiModelsRefreshed"));
      return serializedModels;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${t("openaiModelsRefreshFailed")}: ${message}`);
      throw error;
    } finally {
      setRefreshingModels(false);
    }
  };

  const onSubmit = async (data: z.infer<typeof openAiConfigSchema>) => {
    const models = data.key ? await refreshModels(data) : data.models;
    await setOpenai?.({
      ...data,
      models,
    });
    setEditing(false);
    toast.success(t("openaiConfigSaved"));
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex items-start justify-between py-4">
          <div className="">
            <div className="mb-2">Open AI</div>
            <div className="text-sm text-muted-foreground space-y-3">
              <FormField
                control={form.control}
                name="key"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">{t("key")}:</FormLabel>
                      <Input
                        disabled={!editing}
                        type="password"
                        placeholder=""
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("baseUrl")}:
                      </FormLabel>
                      <Input
                        disabled={!editing}
                        placeholder={t("leaveEmptyToUseDefault")}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    </div>
                    <FormDescription>
                      {t("openaiBaseUrlDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="models"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormLabel className="min-w-max">
                        {t("availableModels")}:
                      </FormLabel>
                      <Input
                        disabled
                        placeholder={t("leaveEmptyToUseDefault")}
                        value={field.value}
                        onChange={field.onChange}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!editing || refreshingModels}
                        onClick={() => refreshModels(form.getValues())}
                      >
                        {refreshingModels ? t("loading") : t("refresh")}
                      </Button>
                    </div>
                    <FormDescription>
                      {parseModelList(field.value).length
                        ? t("availableModelsDescription", {
                            count: parseModelList(field.value).length,
                          })
                        : t("availableModelsEmptyDescription")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
