const toPositiveInt = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
};

const buildListResponse = (rows, query = {}) => {
  const allRows = Array.isArray(rows) ? rows : [];
  const total = allRows.length;

  const pageParam = toPositiveInt(query.page);
  const perPageParam = toPositiveInt(query.per_page);

  const page = pageParam || 1;
  const perPage = perPageParam || (total > 0 ? total : 1);
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const normalizedPage = Math.min(page, totalPages);
  const startIndex = (normalizedPage - 1) * perPage;
  const pagedRows = allRows.slice(startIndex, startIndex + perPage);

  return {
    data: pagedRows,
    meta: {
      page: normalizedPage,
      per_page: perPage,
      total,
      total_pages: totalPages,
      count: pagedRows.length
    }
  };
};

module.exports = {
  buildListResponse
};
