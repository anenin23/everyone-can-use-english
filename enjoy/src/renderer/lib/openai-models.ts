const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export const parseModelList = (models?: string) => {
  return Array.from(
    new Set(
      (models || "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
    )
  );
};

export const serializeModelList = (models: string[]) => {
  return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .join(",");
};

export const normalizeOpenAiBaseUrl = (baseUrl?: string) => {
  return (baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, "");
};

export const fetchOpenAiModelIds = async ({
  key,
  baseUrl,
}: Pick<LlmProviderType, "key" | "baseUrl">) => {
  if (!key) {
    throw new Error("OpenAI API key is required");
  }

  const response = await fetch(`${normalizeOpenAiBaseUrl(baseUrl)}/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data)
    ? payload.data
        .map((model: { id?: string }) => model.id)
        .filter((id: unknown): id is string => typeof id === "string" && !!id)
    : [];

  if (!models.length) {
    throw new Error("No models returned");
  }

  return models;
};
