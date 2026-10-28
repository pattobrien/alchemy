export const DEFAULT_CUSTOMER = "my_customer";

export const normalizeCustomer = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? DEFAULT_CUSTOMER : trimmed;
};

export const sameEmail = (left: string | undefined, right: string | undefined) =>
  (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
