use std::io::Write;
use std::net::TcpStream;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;

use anyhow::Context as _;
use ironrdp_connector::{self, ClientConnector, ConnectionResult, Credentials};
use ironrdp_pdu::gcc::KeyboardType;
use ironrdp_pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp_pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp_pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp_pdu::rdp::client_info::{CompressionType, PerformanceFlags, TimezoneInfo};
use ironrdp_session::image::DecodedImage;
use ironrdp_session::{ActiveStage, ActiveStageOutput};
use ironrdp_graphics::image_processing::PixelFormat;
use image::ImageEncoder;
use rustls::pki_types::ServerName;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::rdp::network_client::SimpleNetworkClient;

const FRAME_SEND_INTERVAL_MS: u64 = 33; // ~30fps max

pub struct SessionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: Option<String>,
    pub screen_width: u16,
    pub screen_height: u16,
}

#[derive(Debug, Clone)]
pub enum InputEvent {
    MouseMove { x: u16, y: u16 },
    MouseDown { x: u16, y: u16, button: u8 },
    MouseUp { x: u16, y: u16, button: u8 },
    KeyDown { scancode: u16 },
    KeyUp { scancode: u16 },
}

pub struct SessionHandle {
    pub frame_rx: Option<mpsc::Receiver<Vec<u8>>>,
    pub input_tx: mpsc::Sender<InputEvent>,
    shutdown: Arc<AtomicBool>,
    _join_handle: JoinHandle<()>,
}

impl SessionHandle {
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

pub fn start_session(
    config: SessionConfig,
    app_handle: AppHandle,
    session_id: String,
) -> anyhow::Result<SessionHandle> {
    let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>(4);
    let (input_tx, mut input_rx) = mpsc::channel::<InputEvent>(64);
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();

    let session_id_clone = session_id.clone();
    let join_handle = tokio::task::spawn_blocking(move || {
        if let Err(e) = run_session_blocking(config, frame_tx, &mut input_rx, shutdown_clone) {
            let err_msg = format!("{:?}", e);
            eprintln!("[rdp] session error: {}", err_msg);
            // Notify frontend of connection failure
            let event_name = format!("rdp-error-{}", session_id_clone);
            let _ = app_handle.emit(&event_name, err_msg);
        }
    });

    Ok(SessionHandle {
        frame_rx: Some(frame_rx),
        input_tx,
        shutdown,
        _join_handle: join_handle,
    })
}

fn run_session_blocking(
    config: SessionConfig,
    frame_tx: mpsc::Sender<Vec<u8>>,
    input_rx: &mut mpsc::Receiver<InputEvent>,
    shutdown: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let connector_config = build_connector_config(&config)?;

    let (connection_result, framed) = connect(connector_config, &config.host, config.port)
        .context("RDP connect failed")?;

    eprintln!(
        "[rdp] connected: compression={:?}, desktop={:?}",
        connection_result.compression_type, connection_result.desktop_size
    );

    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );

    active_stage_loop(
        connection_result,
        framed,
        &mut image,
        frame_tx,
        input_rx,
        shutdown,
    )
    .context("RDP active stage failed")?;

    Ok(())
}

fn build_connector_config(config: &SessionConfig) -> anyhow::Result<ironrdp_connector::Config> {
    Ok(ironrdp_connector::Config {
        credentials: Credentials::UsernamePassword {
            username: config.username.clone(),
            password: config.password.clone(),
        },
        domain: config.domain.clone(),
        enable_tls: true,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: ironrdp_connector::DesktopSize {
            width: config.screen_width,
            height: config.screen_height,
        },
        bitmap: Some(ironrdp_connector::BitmapConfig {
            color_depth: 16,
            lossy_compression: true,
            codecs: ironrdp_pdu::rdp::capability_sets::client_codecs_capabilities(&[])
                .map_err(|e| anyhow::anyhow!("client_codecs_capabilities failed: {}", e))?,
        }),
        client_build: 0,
        client_name: "macnest-rdp".to_owned(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
        #[cfg(target_os = "macos")]
        platform: MajorPlatformType::MACINTOSH,
        #[cfg(target_os = "linux")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "windows")]
        platform: MajorPlatformType::WINDOWS,
        enable_server_pointer: false,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        compression_type: Some(CompressionType::Rdp61),
        pointer_software_rendering: true,
        multitransport_flags: None,
        performance_flags: PerformanceFlags::default(),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
        alternate_shell: String::new(),
        work_dir: String::new(),
    })
}

type UpgradedFramed = ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

fn connect(
    config: ironrdp_connector::Config,
    server_name: &str,
    port: u16,
) -> anyhow::Result<(ConnectionResult, UpgradedFramed)> {
    let server_addr = lookup_addr(server_name, port)
        .map_err(|e| anyhow::anyhow!("DNS lookup failed for {}:{}: {}", server_name, port, e))?;
    eprintln!("[rdp] looked up server address: {}", server_addr);

    eprintln!("[rdp] connecting TCP to {} (timeout 10s)...", server_addr);
    let tcp_stream = TcpStream::connect_timeout(&server_addr, Duration::from_secs(10))
        .map_err(|e| anyhow::anyhow!("TCP connect to {} failed: {}", server_addr, e))?;
    eprintln!("[rdp] TCP connected");

    let client_addr = tcp_stream.local_addr()
        .map_err(|e| anyhow::anyhow!("get local addr failed: {}", e))?;
    let mut framed = ironrdp_blocking::Framed::new(tcp_stream);

    let mut connector = ClientConnector::new(config, client_addr);

    eprintln!("[rdp] starting RDP connection sequence...");
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .map_err(|e| {
            anyhow::anyhow!("RDP connect_begin failed at state '{:?}': {:?}", connector.state, e)
        })?;

    eprintln!("[rdp] TLS upgrade needed: {}", connector.should_perform_security_upgrade());

    eprintln!("[rdp] performing TLS upgrade...");
    let initial_stream = framed.into_inner_no_leftover();
    let (upgraded_stream, server_public_key) =
        tls_upgrade(initial_stream, server_name.to_string())
            .map_err(|e| anyhow::anyhow!("TLS upgrade failed: {}", e))?;
    eprintln!("[rdp] TLS handshake complete, server public key extracted");

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);
    let mut upgraded_framed = ironrdp_blocking::Framed::new(upgraded_stream);

    eprintln!("[rdp] finalizing connection (CredSSP + activation)...");
    let mut network_client = SimpleNetworkClient;
    let connection_result = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut network_client,
        server_name.into(),
        server_public_key,
        None,
    )
    .map_err(|e| anyhow::anyhow!("connect_finalize failed: {:?}", e))?;

    eprintln!(
        "[rdp] connected: compression={:?}, desktop={:?}",
        connection_result.compression_type, connection_result.desktop_size
    );

    Ok((connection_result, upgraded_framed))
}

fn active_stage_loop(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    image: &mut DecodedImage,
    frame_tx: mpsc::Sender<Vec<u8>>,
    input_rx: &mut mpsc::Receiver<InputEvent>,
    shutdown: Arc<AtomicBool>,
) -> anyhow::Result<()> {
    let mut active_stage = ActiveStage::new(connection_result);
    let rt = tokio::runtime::Handle::current();
    let mut last_frame_time = std::time::Instant::now();

    // Use short read timeout so the loop can poll shutdown/input frequently.
    framed
        .get_inner_mut()
        .0
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(100)))
        .expect("set_read_timeout call failed");

    'outer: loop {
        if shutdown.load(Ordering::Relaxed) {
            eprintln!("[rdp] shutdown requested");
            break;
        }

        // Drain pending input events and forward them.
        let mut events = Vec::new();
        while let Ok(event) = input_rx.try_recv() {
            events.push(input_event_to_fastpath(event, &mut active_stage));
        }
        if !events.is_empty() {
            match active_stage.process_fastpath_input(image, &events) {
                Ok(outputs) => {
                    for out in outputs {
                        if let ActiveStageOutput::ResponseFrame(frame) = out {
                            if let Err(e) = framed.write_all(&frame).context("write input response") {
                                eprintln!("[rdp] failed to write input response: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[rdp] process input failed: {}", e);
                }
            }
        }

        // Read PDU (blocks at most 100ms due to read timeout).
        let (action, payload) = match framed.read_pdu() {
            Ok((action, payload)) => (action, payload),
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                eprintln!("[rdp] connection closed by server");
                break;
            }
            Err(e) => return Err(anyhow::Error::new(e).context("read frame")),
        };

        let outputs = active_stage.process(image, action, &payload)?;

        let mut has_graphics_update = false;
        for out in &outputs {
            match out {
                ActiveStageOutput::ResponseFrame(frame) => {
                    framed.write_all(frame).context("write response")?;
                }
                ActiveStageOutput::GraphicsUpdate(_region) => {
                    has_graphics_update = true;
                }
                ActiveStageOutput::Terminate(_) => break 'outer,
                _ => {}
            }
        }

        // Send frame if enough time has passed and there was a graphics update.
        if has_graphics_update
            && last_frame_time.elapsed().as_millis() as u64 >= FRAME_SEND_INTERVAL_MS
        {
            last_frame_time = std::time::Instant::now();

            match encode_frame_png(image) {
                Ok(png_data) => {
                    if let Err(_e) = rt.block_on(frame_tx.send(png_data)) {
                        eprintln!("[rdp] frame receiver dropped, shutting down session");
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[rdp] failed to encode frame: {}", e);
                }
            }
        }
    }

    Ok(())
}

fn input_event_to_fastpath(
    event: InputEvent,
    active_stage: &mut ActiveStage,
) -> FastPathInputEvent {
    match event {
        InputEvent::MouseMove { x, y } => {
            active_stage.update_mouse_pos(x, y);
            FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::MOVE,
                number_of_wheel_rotation_units: 0,
                x_position: x,
                y_position: y,
            })
        }
        InputEvent::MouseDown { x, y, button } => {
            let flags = match button {
                0 => PointerFlags::LEFT_BUTTON | PointerFlags::DOWN,
                1 => PointerFlags::MIDDLE_BUTTON_OR_WHEEL | PointerFlags::DOWN,
                2 => PointerFlags::RIGHT_BUTTON | PointerFlags::DOWN,
                _ => PointerFlags::DOWN,
            };
            FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: 0,
                x_position: x,
                y_position: y,
            })
        }
        InputEvent::MouseUp { x, y, button } => {
            let flags = match button {
                0 => PointerFlags::LEFT_BUTTON,
                1 => PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
                2 => PointerFlags::RIGHT_BUTTON,
                _ => PointerFlags::empty(),
            };
            FastPathInputEvent::MouseEvent(MousePdu {
                flags,
                number_of_wheel_rotation_units: 0,
                x_position: x,
                y_position: y,
            })
        }
        InputEvent::KeyDown { scancode } => {
            FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), scancode as u8)
        }
        InputEvent::KeyUp { scancode } => {
            FastPathInputEvent::KeyboardEvent(KeyboardFlags::RELEASE, scancode as u8)
        }
    }
}

fn encode_frame_png(image: &DecodedImage) -> anyhow::Result<Vec<u8>> {
    let width = image.width() as u32;
    let height = image.height() as u32;
    let data = image.data();

    let img_buffer: image::ImageBuffer<image::Rgba<u8>, _> =
        image::ImageBuffer::from_raw(width, height, data.to_vec())
            .context("invalid image dimensions")?;

    let mut png_data = Vec::new();
    {
        let mut encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        encoder.write_image(
            img_buffer.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        ).context("PNG encode failed")?;
    }

    Ok(png_data)
}

fn lookup_addr(hostname: &str, port: u16) -> anyhow::Result<std::net::SocketAddr> {
    use std::net::ToSocketAddrs as _;
    let addr = (hostname, port)
        .to_socket_addrs()?
        .next()
        .context("socket address not found")?;
    Ok(addr)
}

fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> anyhow::Result<(rustls::StreamOwned<rustls::ClientConnection, TcpStream>, Vec<u8>)> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(danger::NoCertificateVerification))
        .with_no_client_auth();

    config.key_log = std::sync::Arc::new(rustls::KeyLogFile::new());
    config.resumption = rustls::client::Resumption::disabled();

    let config = std::sync::Arc::new(config);
    let server_name: ServerName = server_name.try_into()?;
    let client = rustls::ClientConnection::new(config, server_name)?;

    let mut tls_stream = rustls::StreamOwned::new(client, stream);
    tls_stream.flush()?;

    let cert = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .context("peer certificate is missing")?;

    let server_public_key = extract_tls_server_public_key(cert)?;

    Ok((tls_stream, server_public_key))
}

fn extract_tls_server_public_key(cert: &[u8]) -> anyhow::Result<Vec<u8>> {
    use x509_cert::der::Decode as _;

    let cert = x509_cert::Certificate::from_der(cert)?;

    eprintln!("[rdp] server cert subject: {}", cert.tbs_certificate.subject);

    let server_public_key = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .context("subject public key BIT STRING is not aligned")?
        .to_owned();

    Ok(server_public_key)
}

mod danger {
    use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use rustls::{DigitallySignedStruct, Error, SignatureScheme, pki_types};

    #[derive(Debug)]
    pub(super) struct NoCertificateVerification;

    impl ServerCertVerifier for NoCertificateVerification {
        fn verify_server_cert(
            &self,
            _: &pki_types::CertificateDer<'_>,
            _: &[pki_types::CertificateDer<'_>],
            _: &pki_types::ServerName<'_>,
            _: &[u8],
            _: pki_types::UnixTime,
        ) -> Result<ServerCertVerified, Error> {
            Ok(ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![
                SignatureScheme::RSA_PKCS1_SHA1,
                SignatureScheme::ECDSA_SHA1_Legacy,
                SignatureScheme::RSA_PKCS1_SHA256,
                SignatureScheme::ECDSA_NISTP256_SHA256,
                SignatureScheme::RSA_PKCS1_SHA384,
                SignatureScheme::ECDSA_NISTP384_SHA384,
                SignatureScheme::RSA_PKCS1_SHA512,
                SignatureScheme::ECDSA_NISTP521_SHA512,
                SignatureScheme::RSA_PSS_SHA256,
                SignatureScheme::RSA_PSS_SHA384,
                SignatureScheme::RSA_PSS_SHA512,
                SignatureScheme::ED25519,
                SignatureScheme::ED448,
            ]
        }
    }
}
