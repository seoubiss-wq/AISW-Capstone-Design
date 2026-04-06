import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders TastePick brand on the auth screen", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      items: [],
      personalizationApplied: "",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  expect(screen.getAllByText(/TastePick/i).length).toBeGreaterThan(0);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
});
