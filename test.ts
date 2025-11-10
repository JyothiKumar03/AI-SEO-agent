import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { generateText } from "ai";
import z from "zod";
const gemini = createGoogleGenerativeAI({ apiKey: "" });

// const tools = {
//   google_get_page_content: {
//     execute: () => {
//       return "google_get_page_content";
//     },
//     inputSchema: z.object({
//       ggwp: z.array(z.string()).describe("ggwp"),
//     }),
//   },
// };

const result = async () => {
  const res = await generateText({
    model: gemini("gemini-2.5-flash"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "tell me about prodgain company, search for it, read the pages and tell me about its employees, also give the urls u've read and searched for",
          },
        ],
      },
    ],
    maxOutputTokens: 400,
    temperature: 0.3,
    tools: {
      url_context: gemini.tools.urlContext({}) as any,
      google_grounding: gemini.tools.googleSearch({}) as any,
    },
  });

  console.log(JSON.stringify(res));
};

result().catch((err) => {
  console.log(err);
});
