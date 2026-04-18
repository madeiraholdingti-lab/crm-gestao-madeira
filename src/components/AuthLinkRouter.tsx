import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Handles auth links that may land on "/" (e.g. password recovery), preserving hash/query.
 */
export function AuthLinkRouter() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const hashParams = new URLSearchParams(
      location.hash?.startsWith("#") ? location.hash.slice(1) : location.hash
    );
    const searchParams = new URLSearchParams(location.search);

    const type = hashParams.get("type") || searchParams.get("type");

    if (type === "recovery") {
      navigate(
        {
          pathname: "/auth/reset",
          search: location.search,
          hash: location.hash,
        },
        { replace: true }
      );
      return;
    }

    navigate("/home", { replace: true });
  }, [location.hash, location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
