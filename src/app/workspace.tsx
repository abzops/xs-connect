import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Role, StaffRow, Workspace } from '../lib/types';
import { useAuth } from './auth';

export type WorkspaceContextValue = {
  ws: Workspace;
  role: Role;
  /** UI hint only — the database enforces every permission. */
  can: (permission: string) => boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside a brand route');
  return value;
}

export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** Brands the signed-in user works at. */
export function useMyWorkspaces() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my-workspaces', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_staff')
        .select('role, status, workspaces!inner(id, name, slug)')
        .eq('user_id', session!.user.id)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []) as unknown as Array<Pick<StaffRow, 'role' | 'status'> & { workspaces: Pick<Workspace, 'id' | 'name' | 'slug'> }>;
    },
  });
}

/** Loads a brand by slug plus the caller's role and permissions. */
export function useWorkspaceBySlug(slug: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['workspace', slug, session?.user.id],
    enabled: !!slug && !!session,
    queryFn: async (): Promise<WorkspaceContextValue | null> => {
      const { data: ws, error } = await supabase.from('workspaces').select('*').eq('slug', slug!).maybeSingle();
      if (error) throw error;
      if (!ws) return null;
      const staff = await supabase.from('workspace_staff').select('role').eq('workspace_id', ws.id).eq('user_id', session!.user.id).single();
      if (staff.error) throw staff.error;
      const role = staff.data.role as Role;
      const perms = await supabase.from('role_permissions').select('permission').eq('role', role);
      if (perms.error) throw perms.error;
      const set = new Set(perms.data.map((p) => p.permission as string));
      return { ws: ws as Workspace, role, can: (p) => set.has(p) };
    },
  });
}
