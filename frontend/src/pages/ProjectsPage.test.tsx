import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Project } from "../types/api";
import ProjectsPage from "./ProjectsPage";

const project = (id: number, name: string, screenshot_count = 0): Project => ({
  id,
  name,
  screenshot_count,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => handler(String(input), init));
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProjectsPage />
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

test("renders the project list with counts", async () => {
  mockFetch(() => jsonResponse([project(1, "Landing", 3), project(2, "Checkout", 1)]));
  renderPage();
  expect(await screen.findByText("Landing")).toBeInTheDocument();
  expect(screen.getByText(/3 screenshots/)).toBeInTheDocument();
  expect(screen.getByText(/1 screenshot ·/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Landing/ })).toHaveAttribute("href", "/projects/1");
});

test("shows an empty state", async () => {
  mockFetch(() => jsonResponse([]));
  renderPage();
  expect(await screen.findByText("No projects yet")).toBeInTheDocument();
});

test("shows an error banner with retry", async () => {
  let calls = 0;
  mockFetch(() => (++calls === 1 ? jsonResponse({ detail: "Server down" }, 500) : jsonResponse([])));
  renderPage();
  expect(await screen.findByRole("alert")).toHaveTextContent("Server down");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("No projects yet")).toBeInTheDocument();
});

test("creates a project and adds it to the list", async () => {
  const fetchMock = mockFetch((_url, init) =>
    init?.method === "POST" ? jsonResponse(project(5, "New one"), 201) : jsonResponse([]),
  );
  renderPage();
  await screen.findByText("No projects yet");

  await userEvent.type(screen.getByLabelText("Project name"), "  New one ");
  await userEvent.click(screen.getByRole("button", { name: "Create project" }));

  expect(await screen.findByText("New one")).toBeInTheDocument();
  expect(screen.getByLabelText("Project name")).toHaveValue("");
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({ name: "New one" });
});

test("deletes a project after confirmation", async () => {
  const fetchMock = mockFetch((_url, init) =>
    init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse([project(1, "Doomed")]),
  );
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Delete Doomed" }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent('"Doomed" and all its screenshots');
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(screen.queryByText("Doomed")).not.toBeInTheDocument());
  expect(screen.getByText("No projects yet")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/1", { method: "DELETE" });
});

test("cancel keeps the project", async () => {
  const fetchMock = mockFetch(() => jsonResponse([project(1, "Keeper")]));
  renderPage();
  await userEvent.click(await screen.findByRole("button", { name: "Delete Keeper" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Keeper")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
