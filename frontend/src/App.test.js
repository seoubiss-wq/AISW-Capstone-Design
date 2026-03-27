import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders TastePick brand on the auth screen", () => {
  render(<App />);
  expect(screen.getAllByText(/TastePick/i).length).toBeGreaterThan(0);
});
