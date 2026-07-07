import { render, screen } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => []
  });
});

afterEach(() => {
  jest.resetAllMocks();
});

test("renders the chat shell", async () => {
  render(<App />);

  expect(await screen.findByText("Chats")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /\+ new chat/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/ask something/i)).toBeInTheDocument();
});
