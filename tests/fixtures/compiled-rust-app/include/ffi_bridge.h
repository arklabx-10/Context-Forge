#pragma once
#include <cstdint>

namespace telemetry_ffi {
class NativeBridge {
public:
    explicit NativeBridge(uint32_t channel);
    uint64_t flush() const;
};
}
