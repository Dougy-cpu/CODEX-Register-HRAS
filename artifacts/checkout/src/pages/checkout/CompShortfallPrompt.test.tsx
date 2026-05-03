// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CompShortfallPrompt } from "./CompShortfallPrompt";

afterEach(() => cleanup());

import { afterEach } from "vitest";

describe("<CompShortfallPrompt />", () => {
  it("renders the amber prompt with both 'Reduce' and 'Keep' buttons in the shortfall case", () => {
    render(
      <CompShortfallPrompt remaining={2} quantity={5} onReduce={() => {}} onRemove={() => {}} />,
    );
    // The headline should call out the exact shortfall numbers.
    expect(screen.getByText(/Only 2 complimentary tickets remain/i)).toBeTruthy();
    expect(screen.getByText(/you've selected 5/i)).toBeTruthy();
    // Both action buttons are present.
    expect(screen.getByRole("button", { name: /Reduce to 2 tickets/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Keep my quantity \(remove code\)/i })).toBeTruthy();
  });

  it("singularises the headline and Reduce-button copy when only one seat remains", () => {
    render(
      <CompShortfallPrompt remaining={1} quantity={4} onReduce={() => {}} onRemove={() => {}} />,
    );
    expect(screen.getByText(/Only 1 complimentary ticket remains/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reduce to 1 ticket$/i })).toBeTruthy();
  });

  it("hides the Reduce button when no comp seats remain (only 'Keep my quantity' offered)", () => {
    render(
      <CompShortfallPrompt remaining={0} quantity={3} onReduce={() => {}} onRemove={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /Reduce to/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Keep my quantity \(remove code\)/i })).toBeTruthy();
  });

  it("invokes onReduce exactly once when the user clicks the Reduce button", () => {
    const onReduce = vi.fn();
    const onRemove = vi.fn();
    render(
      <CompShortfallPrompt remaining={2} quantity={5} onReduce={onReduce} onRemove={onRemove} />,
    );
    screen.getByRole("button", { name: /Reduce to 2 tickets/i }).click();
    expect(onReduce).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("invokes onRemove exactly once when the user clicks the Keep button", () => {
    const onReduce = vi.fn();
    const onRemove = vi.fn();
    render(
      <CompShortfallPrompt remaining={2} quantity={5} onReduce={onReduce} onRemove={onRemove} />,
    );
    screen.getByRole("button", { name: /Keep my quantity \(remove code\)/i }).click();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onReduce).not.toHaveBeenCalled();
  });
});
