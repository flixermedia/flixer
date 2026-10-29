terraform {
  required_providers {
    coder = {
      source = "coder/coder"
    }
    docker = {
      source = "kreuzwerker/docker"
    }
  }
}

provider "docker" {}

variable "tailscale_auth_key" {
  type        = string
  description = "Tailscale auth key used to join each workspace to the tailnet."
  sensitive   = true
}

variable "smb_password" {
  type        = string
  description = "Password for the coder account on the workspace SMB share."
  sensitive   = true
}

data "coder_provisioner" "me" {}
data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

# Uses the GitHub external auth provider (id "github") of the Coder deployment when it is configured; the owner links their account once.
data "coder_external_auth" "github" {
  id       = "github"
  optional = true
}

data "coder_parameter" "git_base_url" {
  name         = "git_base_url"
  display_name = "Git base URL"
  description  = "Where flixer, flixer-web, flixer-indexer, flixer-streamer and flixer-docs are cloned from."
  type         = "string"
  default      = "https://github.com/flixermedia"
  mutable      = false
}

data "coder_parameter" "public_url" {
  name         = "public_url"
  display_name = "Public URL of the web app"
  description  = "Browser address of the workspace's \"Flixer\" app, e.g. https://web--main--my-workspace--me.coder.example.com. Used for links, passkeys and CORS. Leave empty for http://localhost:5173 (port-forward)."
  type         = "string"
  default      = ""
  mutable      = true
}

data "coder_parameter" "media_host_path" {
  name         = "media_host_path"
  display_name = "Media folder on the Docker host"
  description  = "Optional absolute path on the Docker host mounted read-only at /media for libraries. Leave empty to use ~/projects/flixer-data/media."
  type         = "string"
  default      = ""
  mutable      = true
}

locals {
  workspace_name = lower("coder-${data.coder_workspace_owner.me.name}-${data.coder_workspace.me.name}")
  public_url     = data.coder_parameter.public_url.value != "" ? trimsuffix(data.coder_parameter.public_url.value, "/") : "http://localhost:5173"
  public_host    = regex("^https?://([^/:]+)", local.public_url)[0]
}

resource "coder_agent" "main" {
  arch = data.coder_provisioner.me.arch
  os   = "linux"

  env = {
    GIT_AUTHOR_NAME     = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_AUTHOR_EMAIL    = data.coder_workspace_owner.me.email
    GIT_COMMITTER_NAME  = coalesce(data.coder_workspace_owner.me.full_name, data.coder_workspace_owner.me.name)
    GIT_COMMITTER_EMAIL = data.coder_workspace_owner.me.email
    GH_TOKEN            = data.coder_external_auth.github.access_token
    GIT_BASE_URL        = trimsuffix(data.coder_parameter.git_base_url.value, "/")
    PUBLIC_URL          = local.public_url
    PUBLIC_HOST         = local.public_host
  }

  startup_script_behavior = "non-blocking"

  metadata {
    display_name = "Stack"
    key          = "stack"
    script       = "~/bin/flixer-stack status 2>/dev/null | tr '\\n' ' '"
    interval     = 15
    timeout      = 5
  }

  metadata {
    display_name = "Home disk"
    key          = "home_disk"
    script       = "coder stat disk --path $HOME"
    interval     = 60
    timeout      = 1
  }
}

# Clones the repos, installs dependencies and starts api, streamer, indexer, web and docs.
resource "coder_script" "stack" {
  agent_id           = coder_agent.main.id
  display_name       = "Flixer dev stack"
  icon               = "/icon/play.svg"
  run_on_start       = true
  start_blocks_login = false
  script             = file("${path.module}/scripts/setup.sh")
}

resource "coder_app" "web" {
  agent_id     = coder_agent.main.id
  slug         = "web"
  display_name = "Flixer"
  icon         = "/icon/play.svg"
  url          = "https://localhost:5175"
  subdomain    = true
  share        = "public"
}

resource "coder_app" "cloud" {
  agent_id     = coder_agent.main.id
  slug         = "cloud"
  display_name = "Flixer Cloud"
  icon         = "/icon/play.svg"
  url          = "http://localhost:4173"
  subdomain    = true
  share        = "public"
}

resource "coder_app" "docs" {
  agent_id     = coder_agent.main.id
  slug         = "docs"
  display_name = "Flixer Docs"
  icon         = "/icon/markdown.svg"
  url          = "http://localhost:3000"
  subdomain    = true
  share        = "public"
}

module "code-server" {
  count    = data.coder_workspace.me.start_count
  source   = "registry.coder.com/coder/code-server/coder"
  version  = "~> 1.0"
  agent_id = coder_agent.main.id
  folder   = "/home/coder/projects"
  order    = 1
}

resource "docker_image" "workspace" {
  name = "coder-flixer-workspace:${substr(sha1(file("${path.module}/build/Dockerfile")), 0, 12)}"
  build {
    context = "${path.module}/build"
  }
  keep_locally = true
}

resource "docker_image" "samba" {
  name = "coder-flixer-samba:${substr(sha1(join("", [file("${path.module}/samba/Dockerfile"), file("${path.module}/samba/entrypoint.sh"), file("${path.module}/samba/smb.conf")])), 0, 12)}"
  build {
    context = "${path.module}/samba"
  }
  keep_locally = true
}

resource "docker_network" "stack" {
  name = "${local.workspace_name}-${data.coder_workspace.me.id}"
}

resource "docker_volume" "home" {
  name = "${local.workspace_name}-${data.coder_workspace.me.id}-home"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_volume" "data" {
  name = "${local.workspace_name}-${data.coder_workspace.me.id}-data"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_volume" "redis" {
  name = "${local.workspace_name}-${data.coder_workspace.me.id}-redis"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_volume" "tailscale" {
  name = "${local.workspace_name}-${data.coder_workspace.me.id}-tailscale"
  lifecycle {
    ignore_changes = all
  }
}

resource "docker_container" "postgres" {
  count   = data.coder_workspace.me.start_count
  image   = "postgres:16-alpine"
  name    = "${local.workspace_name}-postgres"
  restart = "unless-stopped"
  # Run as the workspace user (uid 1000) so the data folder is readable from the workspace.
  user = "1000:1000"
  # initdb must resolve its uid to a name, and the image has no entry for 1000.
  upload {
    file    = "/etc/passwd"
    content = "root:x:0:0:root:/root:/bin/sh\ncoder:x:1000:1000::/home/coder:/bin/sh\n"
  }
  env = [
    "POSTGRES_USER=flixer",
    "POSTGRES_PASSWORD=flixer",
    "POSTGRES_DB=flixer",
    "PGDATA=/data/database",
  ]
  networks_advanced {
    name    = docker_network.stack.name
    aliases = ["postgres"]
  }
  volumes {
    volume_name    = docker_volume.data.name
    container_path = "/data"
  }
}

resource "docker_container" "redis" {
  count   = data.coder_workspace.me.start_count
  image   = "redis:7-alpine"
  name    = "${local.workspace_name}-redis"
  restart = "unless-stopped"
  command = ["redis-server", "--appendonly", "yes"]
  networks_advanced {
    name    = docker_network.stack.name
    aliases = ["redis"]
  }
  volumes {
    volume_name    = docker_volume.redis.name
    container_path = "/data"
  }
}

resource "docker_container" "workspace" {
  count    = data.coder_workspace.me.start_count
  image    = docker_image.workspace.name
  name     = local.workspace_name
  hostname = data.coder_workspace.me.name
  # Reach the Coder server when its access URL is localhost.
  entrypoint = ["sh", "-c", replace(coder_agent.main.init_script, "/localhost|127\\.0\\.0\\.1/", "host.docker.internal")]
  env        = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]

  # Lets flixer mount SMB shares (via sudo, see SMB_MOUNT_SUDO). mount.cifs also needs
  # DAC_READ_SEARCH, or it fails with "Unable to apply new capability set".
  capabilities {
    add = ["SYS_ADMIN", "DAC_READ_SEARCH"]
  }

  host {
    host = "host.docker.internal"
    ip   = "host-gateway"
  }

  networks_advanced {
    name = docker_network.stack.name
  }

  volumes {
    volume_name    = docker_volume.home.name
    container_path = "/home/coder"
  }

  volumes {
    volume_name    = docker_volume.data.name
    container_path = "/home/coder/projects/flixer-data"
  }

  dynamic "volumes" {
    for_each = data.coder_parameter.media_host_path.value != "" ? [data.coder_parameter.media_host_path.value] : []
    content {
      host_path      = volumes.value
      container_path = "/media"
      read_only      = true
    }
  }

  depends_on = [docker_container.postgres, docker_container.redis]
}

resource "docker_container" "tailscale" {
  count   = data.coder_workspace.me.start_count
  image   = "tailscale/tailscale:stable"
  name    = "${local.workspace_name}-tailscale"
  restart = "unless-stopped"

  network_mode = "container:${docker_container.workspace[count.index].id}"

  env = [
    "TS_AUTHKEY=${var.tailscale_auth_key}",
    "TS_AUTH_ONCE=true",
    "TS_HOSTNAME=${local.workspace_name}",
    "TS_STATE_DIR=/var/lib/tailscale",
    "TS_USERSPACE=false",
    "TS_EXTRA_ARGS=--accept-dns=false",
  ]

  capabilities {
    add = ["NET_ADMIN", "NET_RAW"]
  }

  devices {
    host_path      = "/dev/net/tun"
    container_path = "/dev/net/tun"
    permissions    = "rwm"
  }

  volumes {
    volume_name    = docker_volume.tailscale.name
    container_path = "/var/lib/tailscale"
  }

  depends_on = [docker_container.workspace]
}

resource "docker_container" "samba" {
  count   = data.coder_workspace.me.start_count
  image   = docker_image.samba.name
  name    = "${local.workspace_name}-samba"
  restart = "unless-stopped"

  network_mode = "container:${docker_container.tailscale[count.index].id}"

  env = ["SMB_PASSWORD=${var.smb_password}"]

  volumes {
    volume_name    = docker_volume.home.name
    container_path = "/home/coder"
  }

  volumes {
    volume_name    = docker_volume.data.name
    container_path = "/home/coder/projects/flixer-data"
  }

  depends_on = [docker_container.tailscale]
}
