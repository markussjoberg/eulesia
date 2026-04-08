{
  craneLib,
  src,
  pkgs,
  ...
}: let
  commonArgs = {
    inherit src;
    version = "0.1.0";
    strictDeps = true;
    # josekit depends on openssl-sys for JWE/JWT crypto
    nativeBuildInputs = [pkgs.pkg-config];
    buildInputs = [pkgs.openssl pkgs.libwebp];
  };

  cargoArtifacts = craneLib.buildDepsOnly (commonArgs // {pname = "eulesia-workspace-deps";});

  mkWorkspacePackage = {
    pname,
    cargoExtraArgs,
  }:
    craneLib.buildPackage (commonArgs
      // {
        inherit cargoArtifacts cargoExtraArgs pname;
      });
in {
  package = mkWorkspacePackage {
    pname = "eulesia-server";
    cargoExtraArgs = "-p eulesia-server";
  };

  jobs = mkWorkspacePackage {
    pname = "eulesia-jobs";
    cargoExtraArgs = "-p eulesia-jobs";
  };

  clippy = craneLib.cargoClippy (commonArgs
    // {
      inherit cargoArtifacts;
      cargoClippyExtraArgs = "--workspace --all-targets -- --deny warnings";
    });

  test = craneLib.cargoTest (commonArgs
    // {
      inherit cargoArtifacts;
      cargoExtraArgs = "--workspace";
    });

  fmt = craneLib.cargoFmt {
    inherit src;
    pname = "eulesia-server";
    version = "0.1.0";
  };
}
