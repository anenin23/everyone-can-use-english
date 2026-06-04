import { createContext, useEffect, useState, useContext } from "react";
import {
  AppSettingsProviderContext,
  DbProviderContext,
} from "@renderer/context";
import { SttEngineOptionEnum, UserSettingKeyEnum } from "@/types/enums";
import { GPT_PROVIDERS, TTS_PROVIDERS } from "@renderer/components";
import { LOCAL_APP_MODE, WHISPER_MODELS } from "@/constants";
import log from "electron-log/renderer";
import { parseModelList } from "@renderer/lib/openai-models";

const logger = log.scope("ai-settings-provider.tsx");

type AISettingsProviderState = {
  sttEngine?: SttEngineOptionEnum;
  setSttEngine?: (name: string) => Promise<void>;
  openai?: LlmProviderType;
  setOpenai?: (config: LlmProviderType) => Promise<void>;
  setGptEngine?: (engine: GptEngineSettingType) => void;
  currentGptEngine?: GptEngineSettingType;
  gptProviders?: typeof GPT_PROVIDERS;
  ttsProviders?: typeof TTS_PROVIDERS;
  ttsConfig?: TtsConfigType;
  setTtsConfig?: (config: TtsConfigType) => Promise<void>;
  echogardenSttConfig?: EchogardenSttConfigType;
  setEchogardenSttConfig?: (config: EchogardenSttConfigType) => Promise<void>;
};

const initialState: AISettingsProviderState = {};
const DEFAULT_LOCAL_GPT_ENGINE: GptEngineSettingType = {
  name: "ollama",
  models: {
    default: "llama3.2",
  },
  key: "ollama",
  baseUrl: GPT_PROVIDERS.ollama.baseUrl,
};

const defaultTtsConfig = (language: string): TtsConfigType => ({
  engine: LOCAL_APP_MODE ? "openai" : "enjoyai",
  model: LOCAL_APP_MODE ? "tts-1" : "openai/tts-1",
  voice: "alloy",
  language,
});

export const AISettingsProviderContext =
  createContext<AISettingsProviderState>(initialState);

export const AISettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { EnjoyApp, libraryPath, user, apiUrl, webApi, learningLanguage } =
    useContext(AppSettingsProviderContext);
  const [gptProviders, setGptProviders] = useState<any>(GPT_PROVIDERS);
  const [ttsProviders, setTtsProviders] = useState<any>(TTS_PROVIDERS);
  const db = useContext(DbProviderContext);

  const [sttEngine, setSttEngine] = useState<SttEngineOptionEnum>(
    LOCAL_APP_MODE ? SttEngineOptionEnum.LOCAL : SttEngineOptionEnum.ENJOY_AZURE
  );
  const [ttsConfig, setTtsConfig] = useState<TtsConfigType>(null);
  const [echogardenSttConfig, setEchogardenSttConfig] =
    useState<EchogardenSttConfigType>(null);
  const [gptEngine, setGptEngine] = useState<GptEngineSettingType>({
    ...(LOCAL_APP_MODE
      ? DEFAULT_LOCAL_GPT_ENGINE
      : {
          name: "enjoyai",
          models: {
            default: "gpt-4o",
          },
        }),
  });
  const [openai, setOpenai] = useState<LlmProviderType>(null);

  const refreshGptProviders = async () => {
    let providers = LOCAL_APP_MODE
      ? {
          openai: GPT_PROVIDERS.openai,
          ollama: GPT_PROVIDERS.ollama,
        }
      : GPT_PROVIDERS;

    if (!LOCAL_APP_MODE && webApi) {
      try {
        const config = await webApi.config("gpt_providers");
        providers = Object.assign(providers, config);
      } catch (e) {
        console.warn(`Failed to fetch remote GPT config: ${e.message}`);
      }
    }

    try {
      const ollamaUrl = providers["ollama"]?.baseUrl?.replace(/\/v1\/?$/, "");
      const response = await fetch(ollamaUrl + "/api/tags");
      providers["ollama"].models = (await response.json()).models.map(
        (m: any) => m.name
      );
    } catch (e) {
      console.warn(`No ollama server found: ${e.message}`);
    }

    const openAiModels = parseModelList(openai?.models);
    if (openAiModels.length) {
      providers["openai"].models = openAiModels;
    }

    setGptProviders({ ...providers });
  };

  const refreshTtsProviders = async () => {
    let providers = LOCAL_APP_MODE
      ? {
          openai: TTS_PROVIDERS.openai,
        }
      : TTS_PROVIDERS;

    if (!LOCAL_APP_MODE && webApi) {
      try {
        const config = await webApi.config("tts_providers_v2");
        providers = Object.assign(providers, config);
      } catch (e) {
        console.warn(`Failed to fetch remote TTS config: ${e.message}`);
      }
    }

    setTtsProviders({ ...providers });
  };

  const refreshTtsConfig = async () => {
    let config = await EnjoyApp.userSettings.get(UserSettingKeyEnum.TTS_CONFIG);
    if (!config) {
      config = defaultTtsConfig(learningLanguage);
      EnjoyApp.userSettings.set(UserSettingKeyEnum.TTS_CONFIG, config);
    } else if (LOCAL_APP_MODE && config.engine === "enjoyai") {
      config = defaultTtsConfig(config.language || learningLanguage);
      EnjoyApp.userSettings.set(UserSettingKeyEnum.TTS_CONFIG, config);
    }
    setTtsConfig(config);
  };

  const handleSetTtsConfig = async (config: TtsConfigType) => {
    return EnjoyApp.userSettings
      .set(UserSettingKeyEnum.TTS_CONFIG, config)
      .then(() => {
        setTtsConfig(config);
      });
  };

  const refreshEchogardenSttConfig = async () => {
    let config = await EnjoyApp.userSettings.get(UserSettingKeyEnum.ECHOGARDEN);

    if (!config) {
      let model = "tiny";
      const whisperModel =
        (await EnjoyApp.userSettings.get(UserSettingKeyEnum.WHISPER)) || "";
      if (WHISPER_MODELS.includes(whisperModel)) {
        model = whisperModel;
      } else {
        if (whisperModel.match(/tiny/)) {
          model = "tiny";
        } else if (whisperModel.match(/base/)) {
          model = "base";
        } else if (whisperModel.match(/small/)) {
          model = "small";
        } else if (whisperModel.match(/medium/)) {
          model = "medium";
        } else if (whisperModel.match(/large/)) {
          model = "large-v3-turbo";
        }

        if (
          learningLanguage.match(/en/) &&
          model.match(/tiny|base|small|medium/)
        ) {
          model = `${model}.en`;
        }
      }

      config = {
        engine: "whisper",
        whisper: {
          model,
          temperature: 0.2,
          prompt: "",
          encoderProvider: "cpu",
          decoderProvider: "cpu",
        },
      };
      EnjoyApp.userSettings.set(UserSettingKeyEnum.ECHOGARDEN, config);
    }
    setEchogardenSttConfig(config);
  };

  const handleSetEchogardenSttConfig = async (
    config: EchogardenSttConfigType
  ) => {
    return EnjoyApp.userSettings
      .set(UserSettingKeyEnum.ECHOGARDEN, config)
      .then(() => {
        setEchogardenSttConfig(config);
      });
  };

  useEffect(() => {
    refreshGptProviders();
    refreshTtsProviders();
  }, [openai, gptEngine]);

  useEffect(() => {
    if (db.state !== "connected") return;

    fetchSettings();
  }, [db.state]);

  useEffect(() => {
    if (db.state !== "connected") return;
    if (!libraryPath) return;
  }, [db.state, libraryPath]);

  const handleSetSttEngine = async (name: SttEngineOptionEnum) => {
    setSttEngine(name);
    return EnjoyApp.userSettings.set(UserSettingKeyEnum.STT_ENGINE, name);
  };

  const fetchSettings = async () => {
    const _sttEngine = await EnjoyApp.userSettings.get(
      UserSettingKeyEnum.STT_ENGINE
    );
    if (
      LOCAL_APP_MODE &&
      [SttEngineOptionEnum.ENJOY_AZURE, SttEngineOptionEnum.ENJOY_CLOUDFLARE].includes(
        _sttEngine
      )
    ) {
      await EnjoyApp.userSettings.set(
        UserSettingKeyEnum.STT_ENGINE,
        SttEngineOptionEnum.LOCAL
      );
      setSttEngine(SttEngineOptionEnum.LOCAL);
    } else if (_sttEngine) {
      setSttEngine(_sttEngine);
    }

    const _openai = await EnjoyApp.userSettings.get(UserSettingKeyEnum.OPENAI);
    if (_openai) {
      setOpenai(Object.assign({ name: "openai" }, _openai));
    }

    const _gptEngine = await EnjoyApp.userSettings.get(
      UserSettingKeyEnum.GPT_ENGINE
    );
    if (_gptEngine && !(LOCAL_APP_MODE && _gptEngine.name === "enjoyai")) {
      setGptEngine(_gptEngine);
    } else if (LOCAL_APP_MODE) {
      EnjoyApp.userSettings
        .set(UserSettingKeyEnum.GPT_ENGINE, DEFAULT_LOCAL_GPT_ENGINE)
        .then(() => {
          setGptEngine(DEFAULT_LOCAL_GPT_ENGINE);
        });
    } else if (_openai?.key) {
      const engine = {
        name: "openai",
        models: {
          default: "gpt-4o",
        },
      };
      EnjoyApp.userSettings
        .set(UserSettingKeyEnum.GPT_ENGINE, engine)
        .then(() => {
          setGptEngine(engine);
        });
    } else {
      const engine = {
        name: "enjoyai",
        models: {
          default: "gpt-4o",
        },
      };
      EnjoyApp.userSettings
        .set(UserSettingKeyEnum.GPT_ENGINE, engine)
        .then(() => {
          setGptEngine(engine);
        });
    }

    refreshEchogardenSttConfig();
    refreshTtsConfig();
  };

  const handleSetOpenai = async (config: LlmProviderType) => {
    await EnjoyApp.userSettings.set(UserSettingKeyEnum.OPENAI, config);
    setOpenai(Object.assign({ name: "openai" }, config));
  };

  return (
    <AISettingsProviderContext.Provider
      value={{
        setGptEngine: (engine: GptEngineSettingType) => {
          EnjoyApp.userSettings
            .set(UserSettingKeyEnum.GPT_ENGINE, engine)
            .then(() => {
              setGptEngine(engine);
            });
        },
        currentGptEngine:
          gptEngine.name === "openai"
            ? Object.assign(gptEngine, {
                key: openai?.key,
                baseUrl: openai?.baseUrl,
              })
            : gptEngine.name === "ollama"
            ? Object.assign(gptEngine, {
                key: gptEngine.key || "ollama",
                baseUrl: gptEngine.baseUrl || GPT_PROVIDERS.ollama.baseUrl,
              })
            : Object.assign(gptEngine, {
                key: user?.accessToken,
                baseUrl: `${apiUrl}/api/ai`,
              }),
        openai,
        setOpenai: (config: LlmProviderType) => handleSetOpenai(config),
        echogardenSttConfig,
        setEchogardenSttConfig: (config: EchogardenSttConfigType) =>
          handleSetEchogardenSttConfig(config),
        sttEngine,
        setSttEngine: (name: SttEngineOptionEnum) => handleSetSttEngine(name),
        ttsConfig,
        setTtsConfig: (config: TtsConfigType) => handleSetTtsConfig(config),
        gptProviders,
        ttsProviders,
      }}
    >
      {children}
    </AISettingsProviderContext.Provider>
  );
};
