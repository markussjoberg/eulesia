import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "../lib/api";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  name: string;
}

interface AdminAuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  admin: AdminUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextType | undefined>(
  undefined,
);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(isAdminPath);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [checked, setChecked] = useState(false);

  const checkAuth = useCallback(async () => {
    if (checked) return;
    setIsLoading(true);
    try {
      const data = await api.adminMe();
      setAdmin(data);
      setIsAuthenticated(true);
    } catch {
      setAdmin(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
      setChecked(true);
    }
  }, [checked]);

  useEffect(() => {
    // Only check admin auth on /admin paths — no wasted request for
    // regular users visiting the agora, clubs, DMs, etc.
    if (window.location.pathname.startsWith("/admin")) {
      checkAuth();
    }
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    const data = await api.adminLogin(username, password);
    setAdmin(data);
    setIsAuthenticated(true);
    setChecked(true);
  };

  const logout = async () => {
    try {
      await api.adminLogout();
    } catch {
      // Ignore logout errors
    } finally {
      setAdmin(null);
      setIsAuthenticated(false);
    }
  };

  return (
    <AdminAuthContext.Provider
      value={{ isAuthenticated, isLoading, admin, login, logout }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (context === undefined) {
    throw new Error("useAdminAuth must be used within an AdminAuthProvider");
  }
  return context;
}
