import * as z from "zod/v4";

export const citationSchema = z.object({
  label: z.string(),
  kind: z.string(),
  url: z.string(),
  title: z.string(),
  page: z.number().nullable(),
  slide: z.number().nullable(),
  anchor: z.string().nullable(),
  start_s: z.number().nullable(),
  end_s: z.number().nullable(),
  source_id: z.string(),
  document_id: z.string(),
  chunk_id: z.number(),
});
