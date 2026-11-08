export type JobListing = {
  id: string;
  createdAt: string;
  title: string | null;
  description: string | null;
  area: string | null;
  budget: number | null;
  // Only the renderer uses it; the agent is never given the image URL.
  jobImage: string | null;
};

export type JobPage = {
  jobs: JobListing[];
  hasMore: boolean;
};

// One reply carries at most nine Jobs; the extra row is the hasMore probe.
// Paging and the carousel arrive with the rendering work, not here.
export const JOB_PAGE_SIZE = 9;
export const JOB_FETCH_SIZE = JOB_PAGE_SIZE + 1;
