#include <iostream>
namespace edge_native {
  template <typename T>
  class RingBuffer {
  public:
    size_t capacity() const { return 1024; }
  };
}
