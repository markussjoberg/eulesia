{
  config,
  eulesiaPackages,
  lib,
  ...
}: {
  imports = [
    ../modules/eulesia.nix
  ];

  networking.hostName = "eulesia-prod";
  networking.useDHCP = lib.mkDefault true;

  boot.loader.grub.device = "/dev/sda";
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  services.openssh.enable = true;

  sops = {
    age.keyFile = "/var/lib/sops-nix/key.txt";
    secrets = import ./lib/eulesia-secrets.nix {
      inherit config;
      secretDir = ../../secrets/prod;
    };
  };

  services.eulesia = {
    enable = true;
    package = eulesiaPackages.api;
    frontendPackage = eulesiaPackages.frontend;
    appDomain = "eulesia.eu";
    apiDomain = "api.eulesia.eu";
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
    tls.acmeEmail = "admin@eulesia.eu";
    auth = {
      sessionSecretFile = config.sops.secrets."session-secret".path;
      idura = {
        enable = true;
        domain = "idura.example.invalid";
        clientId = "replace-me";
        callbackUrl = "https://api.eulesia.eu/api/v1/auth/ftn/callback";
        signingKeyFile =
          config.sops.secrets."idura-signing-key.jwk.json".path;
        encryptionKeyFile =
          config.sops.secrets."idura-encryption-key.jwk.json".path;
      };
    };
    meilisearch.masterKeyFile = config.sops.secrets."meili-master-key".path;
    ai.mistralEnabled = true;
    ai.mistralApiKeyFile = config.sops.secrets."mistral-api-key".path;
    push = {
      vapidPublicKeyFile = config.sops.secrets."vapid-public-key".path;
      vapidPrivateKeyFile = config.sops.secrets."vapid-private-key".path;
      firebaseServiceAccountKeyFile =
        config.sops.secrets."firebase-service-account.json".path;
    };
  };

  system.stateVersion = "24.11";
}
