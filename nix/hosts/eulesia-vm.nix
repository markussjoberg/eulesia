{
  config,
  eulesiaPackages,
  pkgs,
  ...
}: {
  imports = [
    ../modules/eulesia.nix
    ../modules/eulesia-jobs.nix
    ../modules/eulesia-server.nix
  ];

  networking = {
    hostName = "eulesia-vm";
    firewall = {
      enable = true;
      allowedTCPPorts = [
        22
        7700
      ];
    };
  };

  microvm = {
    hypervisor = "qemu";
    vcpu = 2;
    mem = 4096;
    shares = [
      {
        proto = "virtiofs";
        tag = "ro-store";
        source = "/nix/store";
        mountPoint = "/nix/.ro-store";
      }
    ];
    writableStoreOverlay = "/nix/.rw-store";
    volumes = [
      {
        mountPoint = "/var";
        image = "var.img";
        size = 8 * 1024;
      }
      {
        mountPoint = "/nix/.rw-store";
        image = "store-overlay.img";
        size = 8 * 1024;
      }
    ];
    interfaces = [
      {
        type = "user";
        id = "vm-eulesia";
        mac = "02:00:00:01:02:01";
      }
    ];
    forwardPorts = [
      {
        from = "host";
        host.port = 18080;
        guest.port = 80;
      }
      {
        from = "host";
        host.port = 2223;
        guest.port = 22;
      }
      {
        from = "host";
        host.port = 17701;
        guest.port = 7700;
      }
    ];
  };

  sops = {
    age.keyFile = "/var/lib/sops-nix/key.txt";
    secrets = import ./lib/eulesia-secrets.nix {
      inherit config;
      secretDir = ../../secrets/test;
    };
  };

  users.users.root = {
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP1USfplYAtcR/hCxKmnypsJpqbU51DezXQgKFZ/lCax"
    ];
  };

  services = {
    openssh = {
      enable = true;
      settings = {
        KbdInteractiveAuthentication = false;
        PasswordAuthentication = false;
        PermitRootLogin = "prohibit-password";
      };
    };

    eulesia = {
      enable = true;
      frontendPackage = eulesiaPackages.frontend;
      appDomain = "localhost";
      apiDomain = "api.localhost";
      tls = {
        enable = false;
        acmeEmail = null;
      };
      email = {
        provider = "smtp";
        from = "noreply@aihiolabs.com";
        smtp = {
          host = "mail.infomaniak.com";
          port = 587;
          secure = false;
          userFile = config.sops.secrets."smtp-user".path;
          passFile = config.sops.secrets."smtp-pass".path;
        };
      };
      auth = {
        sessionSecretFile = config.sops.secrets."session-secret".path;
        registrationMode = "ftn-open";
        idura = {
          enable = true;
          domain = "eulesia-test.criipto.id";
          clientId = "urn:my:application:identifier:923383";
          callbackUrl = "http://localhost:18080/api/v1/auth/ftn/callback";
          signingKeyFile =
            config.sops.secrets."idura-signing-key.jwk.json".path;
          encryptionKeyFile =
            config.sops.secrets."idura-encryption-key.jwk.json".path;
        };
      };
      meilisearch = {
        listenAddress = "0.0.0.0";
        masterKeyFile = config.sops.secrets."meili-master-key".path;
      };
      ai.mistralApiKeyFile = config.sops.secrets."mistral-api-key".path;
      push = {
        vapidPublicKeyFile = config.sops.secrets."vapid-public-key".path;
        vapidPrivateKeyFile = config.sops.secrets."vapid-private-key".path;
        firebaseServiceAccountKeyFile =
          config.sops.secrets."firebase-service-account.json".path;
      };
    };

    eulesia-server = {
      enable = true;
      package = eulesiaPackages.server;
      frontendOrigin = "http://localhost:18080";
      cookieSecure = false;
      sessionSecretFile = config.sops.secrets."session-secret".path;
      meilisearch = {
        url = "http://127.0.0.1:7700";
        masterKeyFile = config.sops.secrets."meili-master-key".path;
      };
      idura = {
        enable = true;
        domain = "eulesia-test.criipto.id";
        clientId = "urn:my:application:identifier:923383";
        callbackUrl = "http://localhost:18080/api/v1/auth/ftn/callback";
        signingKeyFile = config.sops.secrets."idura-signing-key.jwk.json".path;
        encryptionKeyFile = config.sops.secrets."idura-encryption-key.jwk.json".path;
      };
      extraEnvironment = {
        APP_URL = "http://localhost:18080";
        API_URL = "http://localhost:18080";
      };
    };

    eulesia-jobs = {
      enable = true;
      package = eulesiaPackages.jobs;
      database.url = "postgresql:///eulesia_v2";
      extraEnvironment = {
        EULESIA_JOBS_LIPAS_ENABLED = "true";
        EULESIA_JOBS_OSM_ENABLED = "true";
      };
    };
  };

  environment.systemPackages = with pkgs; [
    curl
    jq
    postgresql_16
  ];

  systemd.services.logrotate-checkconf.enable = false;

  system.stateVersion = "24.11";
}
