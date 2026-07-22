{ config, pkgs, ... }:

{
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  networking.hostName = "nixos";
  networking.networkmanager.enable = true;
  # Remote browsers must use HTTPS: Balaur's canonical-vault hashing depends
  # on WebCrypto, which browsers withhold from plain HTTP non-localhost origins.
  networking.firewall.interfaces.netbird0.allowedTCPPorts = [
    443
    2222
  ];

  # Native OpenSSH uses a separate NetBird-only port so Android clients such as
  # Termux do not collide with NetBird's embedded SSH interception on port 22.
  services.openssh = {
    enable = true;
    openFirewall = false;
    ports = [ 2222 ];
    settings = {
      KbdInteractiveAuthentication = false;
      PasswordAuthentication = false;
      PermitRootLogin = "no";
      X11Forwarding = false;
    };
  };

  services.netbird.clients.default = {
    name = "netbird";
    interface = "netbird0";
    port = 51820;
    hardened = false;
    config = {
      ServerSSHAllowed = true;
      DisableSSHAuth = false;
      EnableSSHRoot = true;
      EnableSSHSFTP = false;
      EnableSSHLocalPortForwarding = false;
      EnableSSHRemotePortForwarding = false;
    };
    login = {
      enable = true;
      setupKeyFile = "/etc/netbird/setup-key";
    };
  };

  # The setup key is needed only for initial enrollment, not normal startup.
  systemd.services.netbird-login.unitConfig.ConditionPathExists = "/etc/netbird/setup-key";

  services.caddy = {
    enable = true;
    # Client devices trust this CA explicitly; the sandboxed Caddy service must
    # not try (and fail) to modify the development host's system trust store.
    globalConfig = "skip_install_trust";
    virtualHosts."nixos.netbird.cloud".extraConfig = ''
      tls internal

      # The root certificate is public material. Serving it here gives a new
      # NetBird client a bounded bootstrap path; the CA private key remains in
      # Caddy's protected state directory.
      handle /balaur-dev-ca.crt {
        root * /var/lib/caddy/.local/share/caddy/pki/authorities/local
        rewrite * /root.crt
        header Content-Type application/x-x509-ca-cert
        header Content-Disposition "attachment; filename=balaur-dev-ca.crt"
        file_server
      }

      handle {
        reverse_proxy 127.0.0.1:8080
      }
    '';
  };

  systemd.services.caddy = {
    after = [ "balaur-dev.service" "netbird.service" ];
    wants = [ "balaur-dev.service" ];
  };

  systemd.services.balaur-dev = {
    description = "Balaur development server with live reload";
    after = [ "network-online.target" "netbird.service" ];
    wants = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];
    path = [ pkgs.netbird ];

    serviceConfig = {
      User = "balaur";
      Group = "users";
      WorkingDirectory = "/home/balaur/projects/balaur";
      ExecStart = "${pkgs.nodejs_24}/bin/node scripts/balaur-dev.mjs";
      Environment = [
        "HOST=127.0.0.1"
        "PORT=8080"
        "PUBLIC_URL=https://nixos.netbird.cloud"
      ];
      Restart = "on-failure";
      RestartSec = "5s";

      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      ProtectHome = "tmpfs";
      BindPaths = [ "/home/balaur/projects/balaur" ];
    };
  };

  time.timeZone = "Europe/Bucharest";

  i18n.defaultLocale = "en_US.UTF-8";
  i18n.extraLocaleSettings = {
    LC_ADDRESS = "ro_RO.UTF-8";
    LC_IDENTIFICATION = "ro_RO.UTF-8";
    LC_MEASUREMENT = "ro_RO.UTF-8";
    LC_MONETARY = "ro_RO.UTF-8";
    LC_NAME = "ro_RO.UTF-8";
    LC_NUMERIC = "ro_RO.UTF-8";
    LC_PAPER = "ro_RO.UTF-8";
    LC_TELEPHONE = "ro_RO.UTF-8";
    LC_TIME = "ro_RO.UTF-8";
  };

  services.xserver.xkb = {
    layout = "us";
    variant = "";
  };

  users.groups.balaur-secrets = { };

  users.users.balaur = {
    isNormalUser = true;
    description = "balaur";
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPOkyb6k2hdZHcP2gPb24NEroog7e26xA3IKGKkcv8qe u0_a478@localhost"
    ];
    extraGroups = [
      "balaur-secrets"
      "networkmanager"
      "wheel"
    ];
    packages = with pkgs; [ ];
  };

  systemd.tmpfiles.rules = [
    "d /etc/balaur 0750 root balaur-secrets - -"
    "f /etc/balaur/netbird.env 0640 root balaur-secrets - -"
  ];

  security.sudo.wheelNeedsPassword = false;

  nixpkgs.config.allowUnfree = true;
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  environment.sessionVariables = {
    PI_SKIP_VERSION_CHECK = "1";
    PI_TELEMETRY = "0";
  };

  environment.systemPackages = with pkgs; [
    # Languages
    nodejs_24 # latest Node.js LTS (24.x); also pinned by balaur-dev
    go_1_26 # latest Go (1.26.x)
    # Latest Python 3 (3.14.x) with pip bundled, so both `python3 -m pip`
    # and the `pip`/`pip3` commands work out of the box.
    (python314.withPackages (p: [ p.pip ]))

    # Rust SDK (nixpkgs stable toolchain — works with zero configuration).
    # NOTE: do not add `rustup` here alongside these; its rustc/rustdoc
    # proxy shims win the profile symlink collision and break `rustc` until a
    # default toolchain is configured. Add `rustup` on its own if you need to
    # manage nightly/multiple toolchains, then run `rustup default stable`.
    rustc # compiler
    cargo # build tool and package manager
    clippy # linter
    rustfmt # formatter
    rust-analyzer # language server

    # Native build helpers for Rust crates and Python C extensions
    gcc
    gnumake
    pkg-config
    openssl

    # Tooling
    nixd
    nixfmt
    git
    gh
  ];

  system.stateVersion = "26.05";
}
