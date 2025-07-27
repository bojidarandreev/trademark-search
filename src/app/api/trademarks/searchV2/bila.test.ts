import { POST } from "./route";
import * as inpiClient from "@/lib/inpi-client";
import axios from "axios";

const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("@/lib/inpi-client", () => ({
  ...jest.requireActual("@/lib/inpi-client"),
  getAccessToken: jest.fn().mockResolvedValue("dummy_token"),
  logError: jest.fn(),
  client: {
    defaults: {
      jar: {},
    },
  },
}));

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    post: jest.fn().mockResolvedValue({
      data: { result: { hits: { hits: [] } } },
      status: 200,
    }),
  })),
}));

describe("API /api/trademarks/searchV2", () => {
  it("should return a 200 OK response for a valid search", async () => {
    const requestBody = {
      query: {
        type: "brands",
        selectedIds: [],
        sort: "relevance",
        order: "asc",
        nbResultsPerPage: "20",
        page: "1",
        filter: {},
        q: "bila",
        advancedSearch: {},
        displayStyle: "List",
      },
      aggregations: [
        "markCurrentStatusCode",
        "markFeature",
        "registrationOfficeCode",
        "classDescriptionDetails.class",
      ],
    };

    const req = {
      json: async () => requestBody,
    } as any;

    const response = await POST(req);
    expect(response.status).toBe(200);
  });
});
