export const NPI_REGEX = /^\d{10}$/;
export const isValidNpi = (npi: string): boolean => NPI_REGEX.test(npi);
