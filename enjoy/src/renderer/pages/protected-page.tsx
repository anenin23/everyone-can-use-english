import { Navigate } from "react-router-dom";
import { AppSettingsProviderContext } from "../context";
import { useContext } from "react";
import { LOCAL_APP_MODE } from "@/constants";
import { DbState } from "@renderer/components";

export const ProtectedPage = ({
  children,
  redirectPath = "/landing",
}: {
  children: React.ReactNode;
  redirectPath?: string;
}) => {
  const { initialized } = useContext(AppSettingsProviderContext);

  if (!initialized) {
    if (LOCAL_APP_MODE) {
      return (
        <div className="flex justify-center items-center h-full">
          <DbState />
        </div>
      );
    }

    return <Navigate to={redirectPath} replace />;
  }

  return children;
};
