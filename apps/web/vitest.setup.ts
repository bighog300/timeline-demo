import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

import { resetNextNavigationMocks } from "./test/nextNavigationMock";

beforeEach(() => {
  resetNextNavigationMocks();
});
