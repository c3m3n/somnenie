import { createContext, useContext, type ReactNode } from "react";
import { fetchContentService, type ContentService } from "./ContentService";
import { hashNavigationService, type NavigationService } from "./NavigationService";
import { idbStorageService, type StorageService } from "./StorageService";

export interface AppServices {
  content: ContentService;
  navigation: NavigationService;
  storage: StorageService;
}

export const defaultAppServices: AppServices = {
  content: fetchContentService,
  navigation: hashNavigationService,
  storage: idbStorageService,
};

const AppServicesContext = createContext<AppServices>(defaultAppServices);

export function AppServicesProvider({ children, services = defaultAppServices }: { children: ReactNode; services?: AppServices }) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  return useContext(AppServicesContext);
}
