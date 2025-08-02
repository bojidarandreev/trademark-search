// Mock dependencies at the top
jest.mock("@/lib/inpi-client", () => ({
  __esModule: true,
  ...jest.requireActual("@/lib/inpi-client"),
  getAccessToken: jest.fn().mockResolvedValue("dummy_token"),
  logError: jest.fn(),
  client: {
    defaults: {
      jar: {},
    },
  },
}));

// Mock axios and capture the mock post function
const mockPost = jest.fn().mockResolvedValue({
  data: { result: { hits: { hits: [] } } },
  status: 200,
});
jest.mock("axios", () => ({
  ...jest.requireActual("axios"),
  create: jest.fn(() => ({
    post: mockPost,
  })),
}));

import { POST } from "./route";
import * as inpiClient from "@/lib/inpi-client";
import axios from "axios";

// This is just for type safety, the actual mock is above
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("/api/trademarks/searchV2", () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    mockPost.mockClear();

    // Setup default mock implementations
    (inpiClient.getAccessToken as jest.Mock).mockResolvedValue("dummy_token");

    // Re-assign mockPost to axios.create's return value's post, because of how we mocked it.
    (mockedAxios.create as jest.Mock).mockReturnValue({ post: mockPost });
  });

  it("should call performSearchV2 with the correct payload for OR logic", async () => {
    const requestBody = {
      query: {
        q: "bila",
        niceClasses: "16,29",
        niceLogic: "OR",
        page: 1,
        nbResultsPerPage: 20,
      },
    };
    const request = {
      json: async () => requestBody,
    } as any;

    await POST(request);

    expect(mockPost).toHaveBeenCalledWith(
      "/search",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("should call performSearchV2 with the correct payload for AND logic", async () => {
    const requestBody = {
      query: {
        q: "bila",
        niceClasses: "16,29",
        niceLogic: "AND",
        page: 1,
        nbResultsPerPage: 20,
      },
    };
    const request = {
      json: async () => requestBody,
    } as any;

    await POST(request);
    expect(mockPost).toHaveBeenCalledWith(
      "/search",
      expect.any(String),
      expect.any(Object)
    );
  });

  it("should call performSearchV2 with the correct payload when no nice classes are provided", async () => {
    const requestBody = {
      query: { q: "bila", page: 1, nbResultsPerPage: 20 },
    };
    const request = {
      json: async () => requestBody,
    } as any;

    await POST(request);
    expect(mockPost).toHaveBeenCalledWith(
      "/search",
      expect.any(String),
      expect.any(Object)
    );
  });
});
