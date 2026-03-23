import { useAuthStore } from '../stores/auth.store';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

interface SearchResult {
  id: string;
  type: 'provider' | 'practice' | 'enrollment' | 'payer' | 'document';
  title: string;
  subtitle?: string;
  url: string;
}

export function useSearch() {
  const token = useAuthStore((s) => s.token);

  async function search(query: string): Promise<SearchResult[]> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    const res = await fetch(
      `${API_BASE_URL}/search?q=${encodeURIComponent(query)}`,
      { headers },
    );

    if (!res.ok) return [];
    const { data } = await res.json();
    return data;
  }

  return { search };
}
