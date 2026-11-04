import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { Annotation, Project, Screenshot } from "../types/api";
import WorkspacePage from "./WorkspacePage";

const project: Project = {
  id: 1,
  name: "Landing page",
  screenshot_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const annotation = (id: number, number: number, comment: string, x = 0.5, y = 0.5): Annotation => ({
  id,
  screenshot_id: 10,
  number,
  x,
  y,
  comment,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const shot = (id: number, name: string, extra: Partial<Screenshot> = {}): Screenshot => ({
  id,
  project_id: 1,
  original_filename: name,
  mime_type: "image/png",
  file_size: 100,
  width: 800,
  height: 600,
  annotation_count: 0,
  file_available: true,
  image_url: `/api/screenshots/${id}/image`,
  created_at: "2026-01-01T00:00:00Z",
  ...extra,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockApi(screenshots: Screenshot[], handler: Handler = () => undefined) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const custom = handler(url, init);
    if (custom) return custom;
    if (url === "/api/projects/1") return jsonResponse(project);
    if (url === "/api/projects/1/screenshots") return jsonResponse(screenshots);
    if (/^\/api\/screenshots\/\d+\/annotations$/.test(url) && !init?.method) return jsonResponse([]);
    return jsonResponse({ detail: "Not found" }, 404);
  });
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

const renderPage = (path = "/projects/1") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <>
              <WorkspacePage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const thumb = (name: string) => screen.getByTitle(name).closest("button")!;
const findThumb = async (name: string) => (await screen.findByTitle(name)).closest("button")!;
const viewerImage = () => screen.getByRole("main").querySelector("img");
const location = () => screen.getByTestId("location").textContent;

afterEach(() => vi.restoreAllMocks());

test("selects the first screenshot by default and syncs it to the URL", async () => {
  mockApi([shot(10, "home.png", { annotation_count: 3 }), shot(11, "pricing.png")]);
  renderPage();

  expect(await screen.findByRole("heading", { name: "Landing page" })).toBeInTheDocument();
  expect(await screen.findByAltText("home.png")).toHaveAttribute("src", "/api/screenshots/10/image");
  expect(thumb("home.png")).toHaveAttribute("aria-current", "true");
  expect(screen.getByLabelText("3 comments")).toBeInTheDocument();
  await waitFor(() => expect(location()).toBe("?s=10"));
});

test("clicking a thumbnail selects it", async () => {
  mockApi([shot(10, "home.png"), shot(11, "pricing.png")]);
  renderPage();
  await userEvent.click(await findThumb("pricing.png"));

  expect(viewerImage()).toHaveAttribute("alt", "pricing.png");
  expect(thumb("pricing.png")).toHaveAttribute("aria-current", "true");
  expect(location()).toBe("?s=11");
});

test("restores the selection from ?s=", async () => {
  mockApi([shot(10, "home.png"), shot(11, "pricing.png")]);
  renderPage("/projects/1?s=11");
  expect(await screen.findByAltText("pricing.png")).toBeInTheDocument();
});

test("falls back to the first screenshot for an unknown ?s=", async () => {
  mockApi([shot(10, "home.png")]);
  renderPage("/projects/1?s=999");
  expect(await screen.findByAltText("home.png")).toBeInTheDocument();
  await waitFor(() => expect(location()).toBe("?s=10"));
});

test("shows the empty state and uploads the first screenshot", async () => {
  const fetchMock = mockApi([], (url, init) =>
    url === "/api/projects/1/screenshots" && init?.method === "POST"
      ? jsonResponse([shot(20, "new.png")], 201)
      : undefined,
  );
  renderPage();
  expect(await screen.findByText("Upload a screenshot to start")).toBeInTheDocument();

  const file = new File(["png"], "new.png", { type: "image/png" });
  fireEvent.change(screen.getByTestId("upload-input"), { target: { files: [file] } });

  expect(await screen.findByAltText("new.png")).toBeInTheDocument();
  await waitFor(() => expect(location()).toBe("?s=20"));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect((post[1]!.body as FormData).getAll("files")).toEqual([file]);
});

test("shows the server's message when an upload is rejected", async () => {
  mockApi([shot(10, "home.png")], (_url, init) =>
    init?.method === "POST" ? jsonResponse({ detail: "notes.png: File is not a valid image." }, 415) : undefined,
  );
  renderPage();
  await screen.findByAltText("home.png");

  fireEvent.change(screen.getByTestId("upload-input"), {
    target: { files: [new File(["txt"], "notes.png", { type: "image/png" })] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("notes.png: File is not a valid image.");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);

  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("deletes the selected screenshot and selects the next one", async () => {
  const fetchMock = mockApi([shot(10, "home.png"), shot(11, "pricing.png")], (_url, init) =>
    init?.method === "DELETE" ? new Response(null, { status: 204 }) : undefined,
  );
  renderPage();
  await screen.findByAltText("home.png");

  await userEvent.click(screen.getByRole("button", { name: "Delete home.png" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

  expect(await screen.findByAltText("pricing.png")).toBeInTheDocument();
  expect(screen.queryByTitle("home.png")).not.toBeInTheDocument();
  await waitFor(() => expect(location()).toBe("?s=11"));
  expect(fetchMock).toHaveBeenCalledWith("/api/screenshots/10", { method: "DELETE" });
});

test("shows a placeholder when the image file is missing", async () => {
  mockApi([shot(10, "gone.png", { file_available: false })]);
  renderPage();
  expect(await screen.findByText("Image file missing")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete gone.png" })).toBeEnabled();
});

test("shows an error for an unknown project", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ detail: "Project not found" }, 404));
  renderPage("/projects/42");
  expect(await screen.findByText("Project not found")).toBeInTheDocument();
});

test("loads a screenshot's annotations as markers and comments", async () => {
  mockApi([shot(10, "home.png")], (url) =>
    url === "/api/screenshots/10/annotations"
      ? jsonResponse([annotation(1, 1, "Logo is blurry", 0.1, 0.2), annotation(3, 3, "Typo", 0.9, 0.8)])
      : undefined,
  );
  renderPage();
  const marker = await screen.findByRole("button", { name: "Annotation 3" });
  expect(marker).toHaveStyle({ left: "90%", top: "80%" });
  expect(screen.getByRole("button", { name: "Annotation 1" })).toBeInTheDocument();
  const comments = within(screen.getByRole("complementary", { name: "Comments" }));
  expect(comments.getByText("Logo is blurry")).toBeInTheDocument();
  expect(comments.getByText("Typo")).toBeInTheDocument();
  expect(screen.getByLabelText("2 comments")).toBeInTheDocument();
});

test("creating an annotation posts normalized coordinates and shows the numbered marker", async () => {
  const fetchMock = mockApi([shot(10, "home.png")], (url, init) =>
    url === "/api/screenshots/10/annotations" && init?.method === "POST"
      ? jsonResponse({ ...annotation(7, 1, "Make this bigger", 0.25, 0.75) }, 201)
      : undefined,
  );
  renderPage();
  const img = await screen.findByAltText("home.png");
  await screen.findByText("Click the image to add the first comment.");
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 800, 600));

  fireEvent.click(img, { clientX: 300, clientY: 500 });
  await userEvent.type(screen.getByLabelText("Comment"), "Make this bigger");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  const marker = await screen.findByRole("button", { name: "Annotation 1" });
  expect(marker).toHaveAttribute("aria-pressed", "true");
  expect(marker).toHaveStyle({ left: "25%", top: "75%" });
  expect(screen.queryByRole("dialog", { name: "New comment" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("1 comments")).toBeInTheDocument();
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({ x: 0.25, y: 0.75, comment: "Make this bigger" });
});

describe("comment panel", () => {
  const two = () => [annotation(1, 1, "Logo is blurry", 0.1, 0.2), annotation(3, 3, "Typo in hero", 0.9, 0.8)];
  const panel = () => within(screen.getByRole("complementary", { name: "Comments" }));
  const commentRow = (n: number) => panel().getByRole("button", { name: new RegExp(`^Comment ${n}:`) }).closest("li")!;

  const renderLoaded = async () => {
    renderPage();
    await screen.findByRole("button", { name: "Annotation 1" });
  };

  function setupComments(handler: Handler = () => undefined) {
    return mockApi([shot(10, "home.png")], (url, init) => {
      const custom = handler(url, init);
      if (custom) return custom;
      if (url === "/api/screenshots/10/annotations" && !init?.method) return jsonResponse(two());
      return undefined;
    });
  }

  test("selecting a comment highlights its marker", async () => {
    setupComments();
    await renderLoaded();
    await userEvent.click(panel().getByRole("button", { name: /^Comment 3:/ }));

    expect(screen.getByRole("button", { name: "Annotation 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Annotation 1" })).toHaveAttribute("aria-pressed", "false");
    expect(commentRow(3)).toHaveAttribute("aria-current", "true");
  });

  test("selecting a marker highlights and scrolls to its comment", async () => {
    setupComments();
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Annotation 1" }));

    expect(commentRow(1)).toHaveAttribute("aria-current", "true");
    expect(commentRow(3)).not.toHaveAttribute("aria-current");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts.at(-1)).toBe(commentRow(1));
  });

  test("Escape clears the selection", async () => {
    setupComments();
    await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: "Annotation 3" }));
    expect(commentRow(3)).toHaveAttribute("aria-current", "true");
    await userEvent.keyboard("{Escape}");
    expect(commentRow(3)).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Annotation 3" })).toHaveAttribute("aria-pressed", "false");
  });

  test("zoom choice persists when switching screenshots", async () => {
    mockApi([shot(10, "home.png"), shot(11, "pricing.png")]);
    renderPage();
    await screen.findByAltText("home.png");
    await userEvent.click(screen.getByRole("button", { name: "100%" }));
    await userEvent.click(thumb("pricing.png"));
    expect(await screen.findByAltText("pricing.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100%" })).toHaveAttribute("aria-pressed", "true");
  });

  test("hovering either side lightly highlights both", async () => {
    setupComments();
    renderPage();
    const marker = await screen.findByRole("button", { name: "Annotation 3" });

    await userEvent.hover(marker);
    expect(commentRow(3).className).toMatch(/hovered/);
    await userEvent.unhover(marker);
    expect(commentRow(3).className).not.toMatch(/hovered/);

    await userEvent.hover(commentRow(1));
    expect(screen.getByRole("button", { name: "Annotation 1" }).className).toMatch(/hovered/);
  });

  test("edits a comment inline", async () => {
    const fetchMock = setupComments((url, init) =>
      url === "/api/annotations/3" && init?.method === "PATCH"
        ? jsonResponse({ ...annotation(3, 3, "Typo in hero heading"), updated_at: "2026-01-02T00:00:00Z" })
        : undefined,
    );
    await renderLoaded();
    await userEvent.click(panel().getByRole("button", { name: "Edit comment 3" }));
    const box = panel().getByRole("textbox", { name: "Edit comment 3" });
    expect(box).toHaveValue("Typo in hero");
    await userEvent.clear(box);
    await userEvent.type(box, "Typo in hero heading");
    await userEvent.click(panel().getByRole("button", { name: "Save" }));

    expect(await panel().findByText("Typo in hero heading")).toBeInTheDocument();
    expect(panel().getByText("edited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annotation 3" })).toHaveAttribute("title", "Typo in hero heading");
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH")!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ comment: "Typo in hero heading" });
  });

  test("a failed edit keeps the editor open; Escape discards", async () => {
    setupComments((_url, init) =>
      init?.method === "PATCH" ? jsonResponse({ detail: "Server error" }, 500) : undefined,
    );
    await renderLoaded();
    await userEvent.click(panel().getByRole("button", { name: "Edit comment 1" }));
    await userEvent.type(panel().getByRole("textbox"), " now");
    await userEvent.click(panel().getByRole("button", { name: "Save" }));

    expect(await panel().findByRole("alert")).toHaveTextContent("Server error");
    expect(panel().getByRole("textbox")).toHaveValue("Logo is blurry now");
    await userEvent.keyboard("{Escape}");
    expect(panel().queryByRole("textbox")).not.toBeInTheDocument();
    expect(panel().getByText("Logo is blurry")).toBeInTheDocument();
  });

  test("deletes a comment after confirmation and updates marker, selection and count", async () => {
    const fetchMock = setupComments((url, init) =>
      url === "/api/annotations/3" && init?.method === "DELETE" ? new Response(null, { status: 204 }) : undefined,
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Annotation 3" }));
    expect(screen.getByLabelText("2 comments")).toBeInTheDocument();

    await userEvent.click(panel().getByRole("button", { name: "Delete comment 3" }));
    const dialog = screen.getByRole("dialog", { name: "Delete comment?" });
    expect(dialog).toHaveTextContent("Comment #3 will be permanently deleted");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Annotation 3" })).not.toBeInTheDocument());
    expect(panel().queryByText("Typo in hero")).not.toBeInTheDocument();
    expect(screen.getByLabelText("1 comments")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annotation 1" })).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).toHaveBeenCalledWith("/api/annotations/3", { method: "DELETE" });
  });

  test("cancelling the delete keeps the comment", async () => {
    const fetchMock = setupComments();
    await renderLoaded();
    await userEvent.click(panel().getByRole("button", { name: "Delete comment 1" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete comment?" })).getByRole("button", { name: "Cancel" }));
    expect(panel().getByText("Logo is blurry")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
  });
});

test("a network failure shows a readable message", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
  renderPage();
  expect(await screen.findByText("Can't reach the server. Check that the backend is running.")).toBeInTheDocument();
});
