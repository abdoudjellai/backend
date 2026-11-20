export interface Page<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Slice an already filtered and sorted list into one page. */
export function paginate<T>(items: readonly T[], page: number, limit: number): Page<T> {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page, limit, total: items.length, totalPages: Math.ceil(items.length / limit) },
  };
}

/** Newest first. */
export function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }): number {
  return b.createdAt.localeCompare(a.createdAt);
}
