export async function parseJsonArrayResponse(response, errorMessage) {
  if (!response?.ok) {
    throw new Error(errorMessage);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(errorMessage);
  }

  return data;
}
