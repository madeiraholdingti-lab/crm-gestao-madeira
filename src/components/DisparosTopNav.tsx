import { useLocation, useNavigate } from "react-router-dom";
import { Users, Target, Send, Home, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const menuItems = [
  {
    title: "Visão Geral",
    path: "/disparos-em-massa",
    icon: Home,
    exact: true
  },
  {
    title: "Leads",
    path: "/disparos-em-massa/leads",
    icon: Users,
    exact: false
  },
  {
    title: "Campanhas",
    path: "/disparos-em-massa/campanhas",
    icon: Target,
    exact: false
  },
  {
    title: "Envios",
    path: "/disparos-em-massa/envios",
    icon: Send,
    exact: false
  },
  {
    title: "Blacklist",
    path: "/disparos-em-massa/blacklist",
    icon: Ban,
    exact: false
  }
];

export default function DisparosTopNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string, exact: boolean) => {
    if (exact) {
      return location.pathname === path;
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="sticky top-0 z-30 bg-background border-b shadow-sm -mx-4 md:-mx-6 px-4 md:px-6 mb-4">
      <div className="flex items-center gap-1 py-2 overflow-x-auto">
        {menuItems.map((item) => {
          const active = isActive(item.path, item.exact);
          return (
            <Button
              key={item.path}
              variant={active ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "gap-2 shrink-0",
                active && "bg-primary/10 text-primary font-medium"
              )}
              onClick={() => navigate(item.path)}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
