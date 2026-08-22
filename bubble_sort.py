def bubble_sort(arr):
    """对列表进行冒泡排序（原地排序）"""
    n = len(arr)
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        # 如果本轮没有交换，说明已有序，提前结束
        if not swapped:
            break
    return arr


if __name__ == "__main__":
    nums = [64, 34, 25, 12, 22, 11, 90]
    print("排序前:", nums)
    bubble_sort(nums)
    print("排序后:", nums)
