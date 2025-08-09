This project is a web application designed to search for French trademarks. It offers a user-friendly interface that allows users to search for trademarks by name and refine their searches using filters such as the Nice Classification system and the trademark's origin (France, European Union, or World Intellectual Property Organization).

Built with Next.js, React, and TypeScript, the application's user interface is styled using Tailwind CSS and features components from shadcn/ui.

The backend is a Next.js API route that functions as a proxy to the official French National Institute of Industrial Property (INPI) API. It manages user authentication with the INPI service, builds search queries based on user input, and forwards these requests to the INPI API. To optimize performance and minimize redundant API calls, the backend caches the search results.

Authentication with the INPI API is a multi-step process that involves fetching an XSRF token and then exchanging user credentials for an access token. This logic is handled by a dedicated client module.

The project is well-structured, with a clear separation of concerns between the frontend UI, the backend API proxy, and the INPI API client.