import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface AppPayloadConfig {
  verifyPayload: string;
  verifyCallbackUrl: string;
  confirmedPayload: string;
  confirmedCallbackUrl: string;
}

export interface OverlayAppConfig {
  id: string;
  name: string;
  enabled: boolean;
  payloads: AppPayloadConfig;
}

interface OverlayAppsContextType {
  apps: OverlayAppConfig[];
  mainWebhookUrl: string;
  setMainWebhookUrl: (url: string) => void;
  updateApp: (appId: string, updates: Partial<OverlayAppConfig>) => void;
  updateAppPayloads: (appId: string, payloads: Partial<AppPayloadConfig>) => void;
  isAppEnabled: (appId: string) => boolean;
  getAppConfig: (appId: string) => OverlayAppConfig | undefined;
}

const DEFAULT_APPS: OverlayAppConfig[] = [
  {
    id: "calendar",
    name: "Google Agenda",
    enabled: true,
    payloads: {
      verifyPayload: JSON.stringify({
        tipo: "calendar",
        subtipo: "verify",
        messages: "{{messages_array}}",
        contact_name: "{{contact_name}}",
        contact_phone: "{{contact_phone}}"
      }, null, 2),
      verifyCallbackUrl: "",
      confirmedPayload: JSON.stringify({
        tipo: "calendar",
        subtipo: "confirmed",
        event: {
          title: "{{title}}",
          start: "{{start_date}}",
          end: "{{end_date}}",
          description: "{{description}}"
        }
      }, null, 2),
      confirmedCallbackUrl: "",
    },
  },
  {
    id: "crm",
    name: "Maikonect",
    enabled: false,
    payloads: {
      verifyPayload: "{}",
      verifyCallbackUrl: "",
      confirmedPayload: "{}",
      confirmedCallbackUrl: "",
    },
  },
  {
    id: "archive",
    name: "Arquivar",
    enabled: false,
    payloads: {
      verifyPayload: "{}",
      verifyCallbackUrl: "",
      confirmedPayload: "{}",
      confirmedCallbackUrl: "",
    },
  },
  {
    id: "priority",
    name: "Prioridade",
    enabled: false,
    payloads: {
      verifyPayload: "{}",
      verifyCallbackUrl: "",
      confirmedPayload: "{}",
      confirmedCallbackUrl: "",
    },
  },
  {
    id: "notify",
    name: "Notificar",
    enabled: false,
    payloads: {
      verifyPayload: "{}",
      verifyCallbackUrl: "",
      confirmedPayload: "{}",
      confirmedCallbackUrl: "",
    },
  },
];

const STORAGE_KEY = "overlay_apps_config";

const OverlayAppsContext = createContext<OverlayAppsContextType | undefined>(undefined);

export function OverlayAppsProvider({ children }: { children: ReactNode }) {
  const [apps, setApps] = useState<OverlayAppConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Merge with defaults to ensure new apps are included
        return DEFAULT_APPS.map(defaultApp => {
          const savedApp = parsed.apps?.find((a: OverlayAppConfig) => a.id === defaultApp.id);
          return savedApp ? { ...defaultApp, ...savedApp } : defaultApp;
        });
      } catch {
        return DEFAULT_APPS;
      }
    }
    return DEFAULT_APPS;
  });

  const [mainWebhookUrl, setMainWebhookUrl] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved).mainWebhookUrl || "";
      } catch {
        return "";
      }
    }
    return "";
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ apps, mainWebhookUrl }));
  }, [apps, mainWebhookUrl]);

  const updateApp = (appId: string, updates: Partial<OverlayAppConfig>) => {
    setApps(prev => prev.map(app => 
      app.id === appId ? { ...app, ...updates } : app
    ));
  };

  const updateAppPayloads = (appId: string, payloads: Partial<AppPayloadConfig>) => {
    setApps(prev => prev.map(app => 
      app.id === appId 
        ? { ...app, payloads: { ...app.payloads, ...payloads } } 
        : app
    ));
  };

  const isAppEnabled = (appId: string) => {
    return apps.find(app => app.id === appId)?.enabled ?? false;
  };

  const getAppConfig = (appId: string) => {
    return apps.find(app => app.id === appId);
  };

  return (
    <OverlayAppsContext.Provider value={{
      apps,
      mainWebhookUrl,
      setMainWebhookUrl,
      updateApp,
      updateAppPayloads,
      isAppEnabled,
      getAppConfig,
    }}>
      {children}
    </OverlayAppsContext.Provider>
  );
}

export function useOverlayApps() {
  const context = useContext(OverlayAppsContext);
  if (!context) {
    throw new Error("useOverlayApps must be used within OverlayAppsProvider");
  }
  return context;
}
