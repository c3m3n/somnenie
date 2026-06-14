import { navigate, parseRoute, routeHash, type Route } from "../../ui/route";

export interface NavigationService {
  navigate(route: Route): void;
  parseRoute(hash?: string): Route;
  routeHash(route: Route): string;
}

export const hashNavigationService: NavigationService = {
  navigate,
  parseRoute,
  routeHash,
};
