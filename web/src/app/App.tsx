import { App as RoutedApp } from "./RoutedApp";
import { AppServicesProvider } from "../shared/services/AppServicesContext";

export function App() {
  return (
    <AppServicesProvider>
      <RoutedApp />
    </AppServicesProvider>
  );
}
