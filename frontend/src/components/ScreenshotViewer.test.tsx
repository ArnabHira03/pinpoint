import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Annotation, Screenshot } from "../types/api";
import ScreenshotViewer, { type Zoom } from "./ScreenshotViewer";

const screenshot: Screenshot = {
  id: 10,
  project_id: 1,
  original_filename: "home.png",
  mime_type: "image/png",
  file_size: 100,
  width: 1000,
  height: 500,
  annotation_count: 0,
  file_available: true,
  image_url: "/api/screenshots/10/image",
  created_at: "2026-01-01T00:00:00Z",
};

const annotation = (id: number, number: number, x: number, y: number): Annotation => ({
  id,
  screenshot_id: 10,
  number,
  x,
  y,
  comment: `Comment ${number}`,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

function setup(annotations: Annotation[] = [], onCreate = vi.fn(), zoom: Zoom = "fit") {
  const onSelect = vi.fn();
  const onZoomChange = vi.fn();
  render(
    <ScreenshotViewer
      screenshot={screenshot}
      zoom={zoom}
      onZoomChange={onZoomChange}
      annotations={annotations}
      selectedAnnotationId={annotations[0]?.id ?? null}
      hoveredAnnotationId={null}
      onSelectAnnotation={onSelect}
      onHoverAnnotation={() => {}}
      onCreateAnnotation={onCreate}
    />,
  );
  const img = screen.getByAltText("home.png");
  // Rendered at half size, offset on the page: 500x250 at (40, 60).
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(new DOMRect(40, 60, 500, 250));
  return { img, onSelect, onCreate, onZoomChange };
}

test("renders markers at percentage positions with the selected one highlighted", () => {
  setup([annotation(1, 1, 0.1, 0.2), annotation(2, 4, 0.5, 1)]);
  const first = screen.getByRole("button", { name: "Annotation 1" });
  expect(first).toHaveStyle({ left: "10%", top: "20%" });
  expect(first).toHaveAttribute("aria-pressed", "true");
  expect(first).toHaveAttribute("title", "Comment 1");
  const second = screen.getByRole("button", { name: "Annotation 4" });
  expect(second).toHaveStyle({ left: "50%", top: "100%" });
  expect(second).toHaveAttribute("aria-pressed", "false");
});

test("clicking the image opens a draft at the normalized point and saves it", async () => {
  const onCreate = vi.fn().mockResolvedValue(annotation(9, 1, 0.5, 0.2));
  const { img, onSelect } = setup([], onCreate);

  fireEvent.click(img, { clientX: 290, clientY: 110 });
  const draft = screen.getByTestId("draft-marker");
  expect(draft).toHaveStyle({ left: "50%", top: "20%" });
  expect(screen.getByLabelText("Comment")).toHaveFocus();

  await userEvent.type(screen.getByLabelText("Comment"), "  Too much padding ");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onCreate).toHaveBeenCalledWith({ x: 0.5, y: 0.2, comment: "Too much padding" });
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();
  expect(onSelect).toHaveBeenLastCalledWith(9);
});

test("Ctrl+Enter saves and Escape cancels", async () => {
  const onCreate = vi.fn().mockResolvedValue(annotation(9, 1, 0.5, 0.5));
  const { img } = setup([], onCreate);

  fireEvent.click(img, { clientX: 290, clientY: 185 });
  await userEvent.type(screen.getByLabelText("Comment"), "draft");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();
  expect(onCreate).not.toHaveBeenCalled();

  fireEvent.click(img, { clientX: 290, clientY: 185 });
  await userEvent.type(screen.getByLabelText("Comment"), "quick save{Control>}{Enter}{/Control}");
  expect(onCreate).toHaveBeenCalledWith({ x: 0.5, y: 0.5, comment: "quick save" });
});

test("a failed save keeps the draft open with an error and retry", async () => {
  const onCreate = vi
    .fn()
    .mockRejectedValueOnce(new Error("Network down"))
    .mockResolvedValueOnce(annotation(9, 1, 0.5, 0.5));
  const { img } = setup([], onCreate);

  fireEvent.click(img, { clientX: 290, clientY: 185 });
  await userEvent.type(screen.getByLabelText("Comment"), "Keep me");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Network down");
  expect(screen.getByTestId("draft-marker")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Annotation/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Comment")).toHaveValue("Keep me");

  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onCreate).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();
});

test("blank comments cannot be saved", async () => {
  const { img, onCreate } = setup();
  fireEvent.click(img, { clientX: 290, clientY: 185 });
  await userEvent.type(screen.getByLabelText("Comment"), "   ");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  expect(onCreate).not.toHaveBeenCalled();
});

test("clicking a marker selects it without starting a new annotation", async () => {
  const { onSelect } = setup([annotation(1, 1, 0.1, 0.2), annotation(2, 2, 0.6, 0.6)]);
  await userEvent.click(screen.getByRole("button", { name: "Annotation 2" }));
  expect(onSelect).toHaveBeenCalledWith(2);
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();
});

test("clicks while a draft is open, or outside the image, are ignored", () => {
  const { img } = setup();
  fireEvent.click(img, { clientX: 600, clientY: 100 }); // right of the image
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();

  fireEvent.click(img, { clientX: 90, clientY: 85 });
  fireEvent.click(img, { clientX: 490, clientY: 285 });
  const draft = screen.getByTestId("draft-marker");
  expect(draft).toHaveStyle({ left: "10%", top: "10%" });
  expect(screen.getAllByTestId("draft-marker")).toHaveLength(1);
});

test("the editor flips near the right and bottom edges", () => {
  const { img } = setup();
  fireEvent.click(img, { clientX: 490, clientY: 285 });
  expect(screen.getByRole("dialog", { name: "New comment" }).className).toMatch(/flipX.*flipY/);
});

test("Escape cancels the draft even when focus has moved to a button", async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error("Network down"));
  const { img } = setup([], onCreate);
  fireEvent.click(img, { clientX: 290, clientY: 185 });
  await userEvent.type(screen.getByLabelText("Comment"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  screen.getByRole("button", { name: "Retry" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByTestId("draft-marker")).not.toBeInTheDocument();
});

test("zoom toggle reports the choice and 100% removes the fit-to-width cap", async () => {
  const { onZoomChange } = setup([annotation(1, 1, 0.3, 0.6)]);
  expect(screen.getByRole("button", { name: "Fit" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("1000 × 500")).toBeInTheDocument();
  expect(screen.getByTestId("image-frame").className).not.toMatch(/actual/);
  await userEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(onZoomChange).toHaveBeenCalledWith("actual");
});

test("at 100% the markers keep the same percentage positions and clicks still normalize", async () => {
  const onCreate = vi.fn().mockResolvedValue(annotation(9, 2, 0.25, 0.5));
  const { img } = setup([annotation(1, 1, 0.3, 0.6)], onCreate, "actual");
  expect(screen.getByTestId("image-frame").className).toMatch(/actual/);
  expect(screen.getByRole("button", { name: "Annotation 1" })).toHaveStyle({ left: "30%", top: "60%" });

  // Full size and scrolled: the image's left edge is off-screen at -300.
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(new DOMRect(-300, 20, 1000, 500));
  fireEvent.click(img, { clientX: -50, clientY: 270 });
  await userEvent.type(screen.getByLabelText("Comment"), "x{Control>}{Enter}{/Control}");
  expect(onCreate).toHaveBeenCalledWith({ x: 0.25, y: 0.5, comment: "x" });
});
