import type { SupabaseClient } from "@supabase/supabase-js";
import { getJobsClient } from "./supabase-client.js";

export type NewJob = {
  title: string;
  description: string;
  area: string;
  budget: number;
  jobImage: string | null;
  posterPhone: string | null;
};

export type CreatedJob = {
  id: string;
  title: string | null;
};

/**
 * Publishes a Job: one insert, visible to others immediately. `reviewed` is
 * that visibility gate — both migrations filter on it — so publishing is what
 * sets it, and no longer a person in Supabase (ADR 0007). The column name is
 * the debt that decision carries.
 */
export async function publishJob(
  input: NewJob,
  client?: SupabaseClient,
): Promise<CreatedJob> {
  const { data, error } = await (client ?? getJobsClient())
    .from("jobs")
    .insert({
      title: input.title,
      description: input.description,
      area: input.area,
      budget: input.budget,
      job_image: input.jobImage,
      created_by_phone: input.posterPhone,
      reviewed: true,
    })
    .select("id,title")
    .single();
  if (error || !data) throw new Error("Job insert failed", { cause: error });
  return data as CreatedJob;
}
