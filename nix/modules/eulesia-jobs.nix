{
  config,
  lib,
  ...
}:
with lib; let
  cfg = config.services.eulesia-jobs;
in {
  options.services.eulesia-jobs = {
    enable = mkEnableOption "Eulesia scheduled jobs service";

    package = mkOption {
      type = types.package;
      description = "The eulesia-jobs package to run.";
    };

    user = mkOption {
      type = types.str;
      default = config.services.eulesia.user or "eulesia";
      description = "User to run the jobs service as.";
    };

    group = mkOption {
      type = types.str;
      default = config.services.eulesia.group or "eulesia";
      description = "Group to run the jobs service as.";
    };

    logLevel = mkOption {
      type = types.str;
      default = "info";
      description = "Jobs service log level.";
    };

    logJson = mkOption {
      type = types.bool;
      default = true;
      description = "Emit jobs logs as JSON.";
    };

    database.url = mkOption {
      type = types.str;
      default = config.services.eulesia-server.database.url or "postgresql:///eulesia_v2";
      description = "Database URL for scheduled jobs.";
    };

    extraEnvironment = mkOption {
      type = types.attrsOf types.str;
      default = {};
      description = "Extra environment variables for the jobs service.";
    };
  };

  config = mkIf cfg.enable {
    systemd.services.eulesia-jobs = {
      description = "Eulesia Scheduled Jobs";
      wantedBy = ["multi-user.target"];
      wants = ["network-online.target"];
      after =
        ["network-online.target" "eulesia-server.service"]
        ++ optional config.services.eulesia-server.database.createLocally "eulesia-server-db-setup.service";
      requires =
        optional config.services.eulesia-server.database.createLocally "eulesia-server-db-setup.service";

      environment =
        {
          DATABASE_URL = cfg.database.url;
          EULESIA_JOBS_LOG_LEVEL = cfg.logLevel;
          EULESIA_JOBS_LOG_JSON =
            if cfg.logJson
            then "true"
            else "false";
        }
        // cfg.extraEnvironment;

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${cfg.package}/bin/eulesia-jobs";
        Restart = "always";
        RestartSec = 5;
        StateDirectory = "eulesia";
        WorkingDirectory = "/var/lib/eulesia";
      };
    };
  };
}
