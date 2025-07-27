require("whatwg-fetch");

jest.mock("next/server", () => ({
  NextResponse: {
    json: jest.fn((data, { status } = { status: 200 }) => ({
      status,
      json: () => Promise.resolve(data),
    })),
  },
}));
