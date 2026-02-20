import { vi } from "vitest";

const navigationState = vi.hoisted(() => ({
  pathname: "/",
  params: {} as Record<string, string>,
  searchParams: new URLSearchParams(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  routerPrefetch: vi.fn(),
  routerBack: vi.fn(),
  routerForward: vi.fn(),
  routerRefresh: vi.fn(),
}));

export const routerPush = navigationState.routerPush;

export const setSearchParams = (qs: string) => {
  navigationState.searchParams = new URLSearchParams(qs);
};

export const setPathname = (path: string) => {
  navigationState.pathname = path;
};

export const resetNextNavigationMocks = () => {
  navigationState.pathname = "/";
  navigationState.params = {};
  navigationState.searchParams = new URLSearchParams();
  navigationState.routerPush.mockReset();
  navigationState.routerReplace.mockReset();
  navigationState.routerPrefetch.mockReset();
  navigationState.routerBack.mockReset();
  navigationState.routerForward.mockReset();
  navigationState.routerRefresh.mockReset();
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigationState.routerPush,
    replace: navigationState.routerReplace,
    prefetch: navigationState.routerPrefetch,
    back: navigationState.routerBack,
    forward: navigationState.routerForward,
    refresh: navigationState.routerRefresh,
  }),
  useSearchParams: () => navigationState.searchParams,
  usePathname: () => navigationState.pathname,
  useParams: () => navigationState.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
