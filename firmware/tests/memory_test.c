#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

void *runtime_memcpy(void *, const void *, size_t);
void *runtime_memset(void *, int, size_t);

int main(void)
{
    _Alignas(uint32_t) unsigned char source[272], destination[272];
    for (unsigned i = 0; i < sizeof source; ++i) source[i] = (unsigned char)(i * 37u);
    for (unsigned from = 0; from < 8; ++from)
    for (unsigned to = 0; to < 8; ++to)
    for (unsigned n = 0; n <= 256; ++n) {
        for (unsigned i = 0; i < sizeof destination; ++i) destination[i] = 0xa5;
        assert(runtime_memcpy(destination + to, source + from, n) == destination + to);
        for (unsigned i = 0; i < sizeof destination; ++i)
            assert(destination[i] == (i >= to && i < to + n ? source[from + i - to] : 0xa5));
        for (unsigned i = 0; i < sizeof destination; ++i) destination[i] = 0xa5;
        assert(runtime_memset(destination + to, 0x163, n) == destination + to);
        for (unsigned i = 0; i < sizeof destination; ++i)
            assert(destination[i] == (i >= to && i < to + n ? 0x63 : 0xa5));
    }
    puts("freestanding memory: aligned/unaligned copies, fills and boundaries OK");
    return 0;
}
