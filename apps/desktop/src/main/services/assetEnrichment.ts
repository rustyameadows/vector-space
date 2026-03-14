import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AssetEnrichmentView, DominantColorFamily } from '../../shared/contracts';
import { deriveAspectBucket, deriveOrientation } from '../../shared/assetMetadata';

const execFileAsync = promisify(execFile);
const SWIFTC_PATH = '/usr/bin/swiftc';

const EXTRACTOR_SOURCE = String.raw`
import AppKit
import CoreGraphics
import CoreImage
import Foundation
import ImageIO
import Vision

struct Payload: Encodable {
  let ocrText: String
  let dominantColors: [String]
  let hasText: Bool
  let exif: [String: String]
}

func loadCGImage(url: URL) -> CGImage? {
  guard let image = NSImage(contentsOf: url) else { return nil }
  var rect = CGRect(origin: .zero, size: image.size)
  return image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

func extractExif(url: URL) -> [String: String] {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
    return [:]
  }

  var exif: [String: String] = [:]

  if let pixelWidth = properties[kCGImagePropertyPixelWidth] {
    exif["pixelWidth"] = String(describing: pixelWidth)
  }

  if let pixelHeight = properties[kCGImagePropertyPixelHeight] {
    exif["pixelHeight"] = String(describing: pixelHeight)
  }

  if let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
    if let make = tiff[kCGImagePropertyTIFFMake] {
      exif["cameraMake"] = String(describing: make)
    }

    if let model = tiff[kCGImagePropertyTIFFModel] {
      exif["cameraModel"] = String(describing: model)
    }
  }

  if let exifDict = properties[kCGImagePropertyExifDictionary] as? [CFString: Any] {
    if let fNumber = exifDict[kCGImagePropertyExifFNumber] {
      exif["fNumber"] = String(describing: fNumber)
    }

    if let iso = exifDict[kCGImagePropertyExifISOSpeedRatings] {
      exif["iso"] = String(describing: iso)
    }

    if let exposure = exifDict[kCGImagePropertyExifExposureTime] {
      exif["exposureTime"] = String(describing: exposure)
    }

    if let lens = exifDict[kCGImagePropertyExifLensModel] {
      exif["lensModel"] = String(describing: lens)
    }
  }

  return exif
}

func rgbToColorFamily(red: Double, green: Double, blue: Double) -> String {
  let maxValue = max(red, green, blue)
  let minValue = min(red, green, blue)
  let delta = maxValue - minValue
  let brightness = maxValue
  let saturation = maxValue == 0 ? 0 : delta / maxValue

  if brightness < 0.12 {
    return "black"
  }

  if brightness > 0.9 && saturation < 0.12 {
    return "white"
  }

  if saturation < 0.18 {
    return "gray"
  }

  var hue: Double = 0
  if delta != 0 {
    if maxValue == red {
      hue = (green - blue) / delta
    } else if maxValue == green {
      hue = 2 + (blue - red) / delta
    } else {
      hue = 4 + (red - green) / delta
    }
    hue *= 60
    if hue < 0 {
      hue += 360
    }
  }

  switch hue {
  case 0..<15, 345..<360:
    return "red"
  case 15..<35:
    return "orange"
  case 35..<60:
    return "yellow"
  case 60..<150:
    return "green"
  case 150..<185:
    return "teal"
  case 185..<250:
    return "blue"
  case 250..<290:
    return "purple"
  case 290..<345:
    return saturation < 0.42 ? "brown" : "pink"
  default:
    return "gray"
  }
}

func extractDominantColors(cgImage: CGImage) -> [String] {
  let width = 24
  let height = 24
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  let bytesPerPixel = 4
  let bytesPerRow = bytesPerPixel * width
  let bitsPerComponent = 8
  var data = [UInt8](repeating: 0, count: width * height * bytesPerPixel)

  guard let context = CGContext(
    data: &data,
    width: width,
    height: height,
    bitsPerComponent: bitsPerComponent,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    return []
  }

  context.interpolationQuality = .medium
  context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

  var counts: [String: Int] = [:]
  for index in stride(from: 0, to: data.count, by: 4) {
    let red = Double(data[index]) / 255.0
    let green = Double(data[index + 1]) / 255.0
    let blue = Double(data[index + 2]) / 255.0
    let alpha = Double(data[index + 3]) / 255.0
    if alpha < 0.35 {
      continue
    }

    let family = rgbToColorFamily(red: red, green: green, blue: blue)
    counts[family, default: 0] += 1
  }

  return counts
    .sorted { left, right in
      if left.value == right.value {
        return left.key < right.key
      }
      return left.value > right.value
    }
    .prefix(3)
    .map(\.key)
}

func recognizeText(cgImage: CGImage) -> String {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true

  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

  do {
    try handler.perform([request])
    let lines = (request.results ?? [])
      .compactMap { observation in
        observation.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines)
      }
      .filter { !$0.isEmpty }
    return lines.joined(separator: "\n")
  } catch {
    return ""
  }
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  fputs("Missing image path\n", stderr)
  exit(1)
}

let url = URL(fileURLWithPath: arguments[1])
guard let cgImage = loadCGImage(url: url) else {
  fputs("Could not load image\n", stderr)
  exit(1)
}

let text = recognizeText(cgImage: cgImage)
let payload = Payload(
  ocrText: text,
  dominantColors: extractDominantColors(cgImage: cgImage),
  hasText: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
  exif: extractExif(url: url)
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let data = try encoder.encode(payload)
FileHandle.standardOutput.write(data)
`;

type ExtractorPayload = Pick<
  AssetEnrichmentView,
  'ocrText' | 'dominantColors' | 'hasText' | 'exif'
>;

let extractorPathPromise: Promise<string | null> | null = null;

const ensureExtractorBinary = async (): Promise<string | null> => {
  if (extractorPathPromise) {
    return extractorPathPromise;
  }

  extractorPathPromise = (async () => {
    const extractorDir = path.join(os.tmpdir(), 'vector-space-vision-extractor');
    const sourcePath = path.join(extractorDir, 'vision-extractor.swift');
    const binaryPath = path.join(extractorDir, 'vision-extractor');

    await fs.mkdir(extractorDir, { recursive: true });
    await fs.writeFile(sourcePath, EXTRACTOR_SOURCE, 'utf8');

    try {
      await execFileAsync(SWIFTC_PATH, [
        '-O',
        '-framework',
        'AppKit',
        '-framework',
        'Vision',
        '-framework',
        'ImageIO',
        sourcePath,
        '-o',
        binaryPath
      ]);
      return binaryPath;
    } catch {
      return null;
    }
  })();

  return extractorPathPromise;
};

const parseExtractorPayload = (output: string): ExtractorPayload => {
  try {
    const parsed = JSON.parse(output) as {
      ocrText?: string;
      dominantColors?: string[];
      hasText?: boolean;
      exif?: Record<string, string>;
    };

    return {
      ocrText: parsed.ocrText ?? '',
      dominantColors: Array.isArray(parsed.dominantColors)
        ? (parsed.dominantColors as DominantColorFamily[])
        : [],
      hasText: Boolean(parsed.hasText),
      exif: parsed.exif ?? {}
    };
  } catch {
    return {
      ocrText: '',
      dominantColors: [],
      hasText: false,
      exif: {}
    };
  }
};

export interface AssetEnrichmentService {
  extract(input: {
    assetId: string;
    imagePath: string;
    width: number;
    height: number;
    extractionVersion: number;
  }): Promise<AssetEnrichmentView>;
}

export class LocalAssetEnrichmentService implements AssetEnrichmentService {
  public async extract(input: {
    assetId: string;
    imagePath: string;
    width: number;
    height: number;
    extractionVersion: number;
  }): Promise<AssetEnrichmentView> {
    const orientation = deriveOrientation(input.width, input.height);
    const aspectBucket = deriveAspectBucket(input.width, input.height);
    const extractorBinary = await ensureExtractorBinary();

    if (!extractorBinary) {
      return {
        ocrText: '',
        dominantColors: [],
        orientation,
        aspectBucket,
        hasText: false,
        exif: {},
        extractionVersion: input.extractionVersion,
        updatedAt: new Date().toISOString()
      };
    }

    try {
      const { stdout } = await execFileAsync(extractorBinary, [input.imagePath], {
        maxBuffer: 4 * 1024 * 1024
      });
      const payload = parseExtractorPayload(stdout);

      return {
        ocrText: payload.ocrText,
        dominantColors: payload.dominantColors,
        orientation,
        aspectBucket,
        hasText: payload.hasText,
        exif: payload.exif,
        extractionVersion: input.extractionVersion,
        updatedAt: new Date().toISOString()
      };
    } catch {
      return {
        ocrText: '',
        dominantColors: [],
        orientation,
        aspectBucket,
        hasText: false,
        exif: {},
        extractionVersion: input.extractionVersion,
        updatedAt: new Date().toISOString()
      };
    }
  }
}
