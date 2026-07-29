import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { unwrap } from '../http';
import { queryKeys } from '../queryKeys';
import type { components } from '../types';

type ConfigEntry = components['schemas']['ConfigEntry'];

/** GET /config. */
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => unwrap<ConfigEntry[]>(api.GET('/config', {})),
  });
}

/** PATCH /config — partial map of key → string value. */
export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, string>) =>
      unwrap<ConfigEntry[]>(api.PATCH('/config', { body: patch })),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.config }),
  });
}
